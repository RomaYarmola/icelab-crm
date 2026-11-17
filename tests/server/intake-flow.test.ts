import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as retryPost } from "@/app/api/cron/intake-retry/route";
import {
  clients,
  intakeMessages,
  locations,
  orderStatusHistory,
  orders,
  profiles,
} from "@/db/schema";
import { ClaudeError } from "@/server/intake/claude";
import type { ParseResult } from "@/server/intake/schema";
import {
  callbackData,
  describeDraft,
  draftButtons,
  handleCallback,
  parseCallbackData,
  processAndReply,
} from "@/server/intake/telegram-flow";
import { handleUpdate } from "@/server/telegram/updates";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

type Sent = {
  chatId: number;
  text: string;
  threadId?: number;
  replyToMessageId?: number;
  buttons?: { text: string; callbackData: string }[][];
};

describe("чернетка в Telegram: відповідь бота й кнопки (B11, PR 3)", () => {
  let t: OrderTestContext;
  let kyivId: string;
  let clientCode: string;
  let msgNo = 5000;
  const sent: Sent[] = [];
  const edited: { chatId: number; messageId: number; text: string }[] = [];
  const answers: { callbackQueryId: string; text?: string }[] = [];
  const deps = {
    send: async (p: Sent) => {
      sent.push(p);
    },
    edit: async (p: { chatId: number; messageId: number; text: string }) => {
      edited.push(p);
    },
    answer: async (p: { callbackQueryId: string; text?: string }) => {
      answers.push(p);
    },
  };

  const parsed = (overrides: Partial<ParseResult> = {}): ParseResult => ({
    client: { code: clientCode, name_guess: null, confidence: 0.9 },
    order_date: "2034-07-03",
    kg_sold: 40,
    ice_type: "16mm",
    box: { type_code: null, count: null, ownership: null },
    delivery: {
      method: "pickup",
      city: null,
      np_warehouse_number: null,
      address: null,
      time_window: null,
      recipient_name: null,
      recipient_phone: null,
    },
    payment_hint: null,
    comment: null,
    unclear: [],
    ...overrides,
  });
  const claude = (result: ParseResult) => async () => ({
    result,
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    model: "m",
  });
  const message = async (text = "Кафе завтра 40 кг", telegramUserId = 5001) =>
    (
      await t.db
        .insert(intakeMessages)
        .values({
          telegramChatId: -900,
          telegramMessageId: (msgNo += 1),
          telegramThreadId: 7,
          telegramUserId,
          locationId: kyivId,
          text,
        })
        .returning()
    )[0]!;
  const draft = async (result = parsed()) => {
    const row = await message();
    const outcome = await processAndReply(t.db, row.id, { ...deps, claude: claude(result) });
    if (outcome.status !== "drafted") throw new Error(`очікувалась чернетка, є ${outcome.status}`);
    return { row, orderId: outcome.orderId, number: outcome.number };
  };
  const callback = (data: string, from = 5001, id = "cb1") => ({
    id,
    from: { id: from },
    data,
    message: { message_id: 321, chat: { id: -900 }, message_thread_id: 7 },
  });
  const orderOf = async (id: string) =>
    (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const reset = () => {
    sent.length = 0;
    edited.length = 0;
    answers.length = 0;
  };

  beforeAll(async () => {
    t = await setupOrderTests();
    kyivId = (await t.db.select().from(locations).where(eq(locations.code, "kyiv")))[0]!.id;
    clientCode = (await t.db.select().from(clients).where(eq(clients.id, t.client.id)))[0]!.code;
    await t.db
      .update(profiles)
      .set({ telegramUserId: 5001 })
      .where(eq(profiles.id, t.users.manager.id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("дані кнопок: до 64 байт, розбір лише правильного формату", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    for (const action of ["confirm", "edit", "reject"] as const) {
      expect(Buffer.byteLength(callbackData(id, action))).toBeLessThanOrEqual(64);
      expect(parseCallbackData(callbackData(id, action))).toEqual({ orderId: id, action });
    }
    for (const bad of ["", "ord:x:confirm", `ord:${id}:delete`, `xyz:${id}:confirm`, undefined]) {
      expect(parseCallbackData(bad as string | undefined), String(bad)).toBeNull();
    }
    expect(draftButtons(id, false)[0]!.map((b) => b.text)).toEqual([
      "Підтвердити",
      "Виправити",
      "Відхилити",
    ]);
    expect(draftButtons(id, true)[0]!.map((b) => b.text)).toEqual(["Виправити", "Відхилити"]);
  });

  it("відповідь у тред заявки: номер, клієнт, кг, лід, дата й три кнопки", async () => {
    reset();
    const { row, orderId } = await draft();
    expect(sent).toHaveLength(1);
    const reply = sent[0]!;
    expect(reply).toMatchObject({
      chatId: -900,
      threadId: 7,
      replyToMessageId: row.telegramMessageId,
    });
    expect(reply.text).toMatch(
      /^Чернетка № \d+: Кафе Тест, 40 кг, 16 мм, Самовивіз|доставка: самовивіз/,
    );
    expect(reply.text).toContain("03.07.2034");
    expect(reply.buttons![0]!.map((b) => b.callbackData)).toEqual([
      callbackData(orderId, "confirm"),
      callbackData(orderId, "edit"),
      callbackData(orderId, "reject"),
    ]);
    const described = await describeDraft(t.db, orderId);
    expect(described).toMatchObject({ isPlaceholder: false });
  });

  it("клієнта не визначено: без кнопки «Підтвердити», у тексті чому", async () => {
    reset();
    const row = await message();
    await processAndReply(t.db, row.id, {
      ...deps,
      claude: claude(
        parsed({ client: { code: null, name_guess: "Невідомий бар", confidence: 0.3 } }),
      ),
    });
    const reply = sent[0]!;
    expect(reply.text).toContain("Клієнта не визначено: «Невідомий бар»");
    expect(reply.buttons![0]!.map((b) => b.text)).toEqual(["Виправити", "Відхилити"]);
  });

  it("помилка розбору: повідомлення з посиланням на нове замовлення, чернетки немає; нічого не пишемо для пропущених", async () => {
    reset();
    const failing = await message();
    const outcome = await processAndReply(t.db, failing.id, {
      ...deps,
      claude: async () => {
        throw new ClaudeError("Немає зв'язку з Claude. Спробуйте ще раз.", { isNetwork: true });
      },
    });
    expect(outcome.status).toBe("failed");
    expect(sent[0]!.text).toContain("Не зміг розібрати, створіть замовлення в CRM:");
    expect(sent[0]!.text).toContain("/orders/new");
    expect(sent[0]!.buttons).toBeUndefined();
    reset();
    const stranger = await message("текст", 424242);
    expect(
      (await processAndReply(t.db, stranger.id, { ...deps, claude: claude(parsed()) })).status,
    ).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("збій відправки в Telegram не ламає приймання: чернетка створена", async () => {
    const row = await message();
    const outcome = await processAndReply(t.db, row.id, {
      claude: claude(parsed()),
      send: async () => {
        throw new Error("Forbidden: bot was kicked");
      },
    });
    expect(outcome.status).toBe("drafted");
  });

  it("«Підтвердити»: замовлення підтверджено, повідомлення змінено, заявка «підтверджено», повторне натискання нічого не міняє", async () => {
    reset();
    const { row, orderId, number } = await draft();
    const outcome = await handleCallback(t.db, callback(callbackData(orderId, "confirm")), deps);
    expect(outcome).toEqual({ kind: "confirmed", orderId });
    expect((await orderOf(orderId)).status).toBe("confirmed");
    expect(edited.at(-1)).toMatchObject({ chatId: -900, messageId: 321 });
    expect(edited.at(-1)!.text).toBe(`Підтверджено № ${number}, у виробництві Київ`);
    expect(answers.at(-1)!.text).toBe("Підтверджено.");
    expect(
      (await t.db.select().from(intakeMessages).where(eq(intakeMessages.id, row.id)))[0]!
        .parseStatus,
    ).toBe("confirmed");
    const historyBefore = (
      await t.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId))
    ).length;
    const again = await handleCallback(
      t.db,
      callback(callbackData(orderId, "confirm"), 5001, "cb2"),
      deps,
    );
    expect(again).toMatchObject({ kind: "already" });
    expect(answers.at(-1)!.text).toBe(`Уже підтверджено № ${number}`);
    expect(
      (await t.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)))
        .length,
    ).toBe(historyBefore);
  });

  it("право: непідключений Telegram, бухгалтер, старший локації й чужа дія отримують «Немає доступу», замовлення лишається чернеткою", async () => {
    const { orderId } = await draft();
    await t.db
      .update(profiles)
      .set({ telegramUserId: 7001 })
      .where(eq(profiles.id, t.users.accountant.id));
    await t.db
      .update(profiles)
      .set({ telegramUserId: 7002 })
      .where(eq(profiles.id, t.users.location_lead.id));
    for (const from of [99999, 7001, 7002]) {
      reset();
      expect(
        await handleCallback(t.db, callback(callbackData(orderId, "confirm"), from), deps),
        String(from),
      ).toEqual({ kind: "denied" });
      expect(answers[0]!.text).toBe("Немає доступу.");
    }
    expect((await orderOf(orderId)).status).toBe("draft");
    expect(edited).toHaveLength(0);
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.accountant.id));
    await t.db
      .update(profiles)
      .set({ telegramUserId: null })
      .where(eq(profiles.id, t.users.location_lead.id));
  });

  it("підтвердити не вдалось (немає типу льоду чи клієнта): текст причини, чернетка лишається, кнопки не зникають", async () => {
    reset();
    const noIce = await draft(parsed({ ice_type: null }));
    const a = await handleCallback(t.db, callback(callbackData(noIce.orderId, "confirm")), deps);
    expect(a).toMatchObject({ kind: "error" });
    expect(answers.at(-1)!.text).toContain("тип льоду");
    expect((await orderOf(noIce.orderId)).status).toBe("draft");
    const noClient = await draft(
      parsed({ client: { code: null, name_guess: "Хтось", confidence: 0.2 } }),
    );
    await handleCallback(t.db, callback(callbackData(noClient.orderId, "confirm")), deps);
    expect(answers.at(-1)!.text).toContain("Оберіть справжнього клієнта");
    expect((await orderOf(noClient.orderId)).status).toBe("draft");
    expect(edited).toHaveLength(0);
  });

  it("«Відхилити»: чернетка видалена, заявка «відхилено», повторно відповідає, що вже відхилено", async () => {
    reset();
    const { row, orderId, number } = await draft();
    expect(await handleCallback(t.db, callback(callbackData(orderId, "reject")), deps)).toEqual({
      kind: "rejected",
      orderId,
    });
    expect((await orderOf(orderId)).deletedAt).not.toBeNull();
    expect(
      (await t.db.select().from(intakeMessages).where(eq(intakeMessages.id, row.id)))[0]!
        .parseStatus,
    ).toBe("rejected");
    expect(edited.at(-1)!.text).toBe(`Відхилено: чернетка № ${number}.`);
    const again = await handleCallback(
      t.db,
      callback(callbackData(orderId, "reject"), 5001, "cb3"),
      deps,
    );
    expect(again).toMatchObject({ kind: "already" });
    expect(answers.at(-1)!.text).toBe("Заявку вже відхилено.");
    // Відхилити вже підтверджене не можна.
    const confirmed = await draft();
    await handleCallback(t.db, callback(callbackData(confirmed.orderId, "confirm")), deps);
    expect(
      (await handleCallback(t.db, callback(callbackData(confirmed.orderId, "reject")), deps)).kind,
    ).toBe("already");
    expect((await orderOf(confirmed.orderId)).deletedAt).toBeNull();
  });

  it("«Виправити»: посилання на форму в CRM, статус не міняється", async () => {
    reset();
    const { orderId } = await draft();
    reset();
    expect(await handleCallback(t.db, callback(callbackData(orderId, "edit")), deps)).toEqual({
      kind: "edit_link",
      orderId,
    });
    expect(sent[0]!.text).toContain(`/orders/${orderId}/edit`);
    expect(sent[0]).toMatchObject({ chatId: -900, threadId: 7, replyToMessageId: 321 });
    expect((await orderOf(orderId)).status).toBe("draft");
  });

  it("невідомі кнопки й чужі дані ігноруються; подія кнопки доходить через handleUpdate", async () => {
    reset();
    expect(await handleCallback(t.db, callback("щось"), deps)).toEqual({ kind: "ignored" });
    expect(answers[0]!.text).toBe("Невідома дія.");
    const { orderId } = await draft();
    const out = await handleUpdate(
      t.db,
      { update_id: 1, callback_query: callback(callbackData(orderId, "confirm")) },
      deps,
    );
    expect(out).toEqual({ kind: "callback", result: "confirmed" });
  });

  it("змінене повідомлення: чернетку оновлено, у відповіді позначка про оновлення", async () => {
    const { row, orderId } = await draft();
    reset();
    await t.db
      .update(intakeMessages)
      .set({ parseStatus: "new", text: "Кафе завтра 55 кг" })
      .where(eq(intakeMessages.id, row.id));
    const outcome = await processAndReply(t.db, row.id, {
      ...deps,
      claude: claude(parsed({ kg_sold: 55 })),
    });
    expect(outcome).toMatchObject({ status: "drafted", updated: true, orderId });
    expect(sent[0]!.text.startsWith("Чернетку оновлено за зміненим повідомленням.")).toBe(true);
    expect(sent[0]!.text).toContain("55 кг");
  });

  it("запасний розклад: без секрету 401", async () => {
    const response = await retryPost(
      new Request("http://x/api/cron/intake-retry", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });
});
