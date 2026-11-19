import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients, intakeMessages, locations, orders, profiles } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import {
  confirmIntakeDraft,
  countIntakeDrafts,
  listIntakeDrafts,
  rejectIntakeDraft,
} from "@/server/intake/drafts";
import { canConfirmDrafts, setConfirmer } from "@/server/intake/confirmers";
import { receiveSiteLead } from "@/server/intake/site-lead";
import { processAndReply } from "@/server/intake/telegram-flow";
import type { ParseResult } from "@/server/intake/schema";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("вкладка «Чернетки» (B11, PR 4)", () => {
  let t: OrderTestContext;
  let kyivId: string;
  let clientCode: string;
  let msgNo = 9000;
  const manager = () => t.users.manager;

  const parsed = (overrides: Partial<ParseResult> = {}): ParseResult => ({
    client: { code: clientCode, name_guess: null, confidence: 0.9 },
    order_date: "2034-09-02",
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
    unclear: ["перевірте дату"],
    ...overrides,
  });
  const telegramDraft = async (text: string, result = parsed()) => {
    const row = (
      await t.db
        .insert(intakeMessages)
        .values({
          telegramChatId: -1,
          telegramMessageId: (msgNo += 1),
          telegramUserId: 5001,
          locationId: kyivId,
          text,
        })
        .returning()
    )[0]!;
    const outcome = await processAndReply(t.db, row.id, {
      send: async () => undefined,
      claude: async () => ({
        result,
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: "m",
      }),
    });
    if (outcome.status !== "drafted") throw new Error(outcome.status);
    return { row, orderId: outcome.orderId };
  };

  beforeAll(async () => {
    t = await setupOrderTests();
    kyivId = (await t.db.select().from(locations).where(eq(locations.code, "kyiv")))[0]!.id;
    clientCode = (await t.db.select().from(clients).where(eq(clients.id, t.client.id)))[0]!.code;
    await t.db.update(profiles).set({ telegramUserId: 5001 }).where(eq(profiles.id, manager().id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("список: чернетки з Telegram і сайту з вихідним текстом, неясним і підказкою про клієнта; звичайні чернетки не потрапляють", async () => {
    const tg = await telegramDraft("Кафе завтра 40 кг, зателефонуйте");
    const site = await receiveSiteLead(t.db, {
      lead: {
        name: "Іван",
        phone: "+380671110000",
        delivery: "Самовивіз",
        items: [{ title: "16 мм", quantity: 10, unit: "кг" }],
      },
      message: "Заявка з форми",
      receivedAt: "2034-08-10T09:00:00Z",
    });
    if (!site.ok) throw new Error("сайт");
    const plain = await t.create({ orderDate: "2034-09-03" });
    const list = await listIntakeDrafts(t.db, manager());
    const byId = new Map(list.map((d) => [d.orderId, d]));
    expect(byId.has(plain.id)).toBe(false);
    expect(byId.get(tg.orderId)).toMatchObject({
      source: "telegram",
      sourceText: "Кафе завтра 40 кг, зателефонуйте",
      clientName: "Кафе Тест",
      isPlaceholder: false,
      unclear: ["перевірте дату"],
      locationName: "Київ",
    });
    expect(byId.get(site.draftId)).toMatchObject({
      source: "site",
      isPlaceholder: true,
      clientName: "Новий клієнт",
    });
    expect(byId.get(site.draftId)!.sourceText).toContain("Телефон: +380671110000");
    expect(byId.get(site.draftId)!.sourceText).toContain("Заявка з форми");
    expect(await countIntakeDrafts(t.db, manager())).toBe(list.length);
  });

  it("права: лише власник і менеджер, старший локації, бухгалтер, цех і водій отримують відмову", async () => {
    for (const role of USER_ROLES) {
      const call = listIntakeDrafts(t.db, t.users[role]);
      if (role === "owner" || role === "manager") await expect(call).resolves.toBeDefined();
      else await expect(call, role).rejects.toThrow(ForbiddenError);
      const count = countIntakeDrafts(t.db, t.users[role]);
      if (role === "owner" || role === "manager")
        await expect(count).resolves.toBeGreaterThanOrEqual(0);
      else await expect(count, role).rejects.toThrow(ForbiddenError);
    }
  });

  it("підтвердити: замовлення підтверджено, заявка «підтверджено», з «Новим клієнтом» не виходить", async () => {
    const { row, orderId } = await telegramDraft("підтвердити мене");
    await confirmIntakeDraft(t.db, manager(), orderId);
    expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
      "confirmed",
    );
    expect(
      (await t.db.select().from(intakeMessages).where(eq(intakeMessages.id, row.id)))[0]!
        .parseStatus,
    ).toBe("confirmed");
    expect((await listIntakeDrafts(t.db, manager())).some((d) => d.orderId === orderId)).toBe(
      false,
    );
    const placeholder = await telegramDraft(
      "без клієнта",
      parsed({ client: { code: null, name_guess: "Хтось", confidence: 0.1 } }),
    );
    await expect(confirmIntakeDraft(t.db, manager(), placeholder.orderId)).rejects.toThrow(
      "Оберіть справжнього клієнта",
    );
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, placeholder.orderId)))[0]!.status,
    ).toBe("draft");
    await expect(confirmIntakeDraft(t.db, t.users.location_lead, orderId)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("відхилити: чернетка видалена, заявка «відхилено», повторно помилка, підтверджене відхилити не можна", async () => {
    const { row, orderId } = await telegramDraft("відхилити мене");
    await rejectIntakeDraft(t.db, manager(), orderId);
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.deletedAt,
    ).not.toBeNull();
    expect(
      (await t.db.select().from(intakeMessages).where(eq(intakeMessages.id, row.id)))[0]!
        .parseStatus,
    ).toBe("rejected");
    await expect(rejectIntakeDraft(t.db, manager(), orderId)).rejects.toThrow("вже відхилено");
    const confirmed = await telegramDraft("підтверджене");
    await confirmIntakeDraft(t.db, manager(), confirmed.orderId);
    await expect(rejectIntakeDraft(t.db, manager(), confirmed.orderId)).rejects.toThrow();
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, confirmed.orderId)))[0]!.deletedAt,
    ).toBeNull();
  });

  it("підтверджувачі (D151): поки список порожній, підтверджують усі; з списком лише позначені; змінює лише власник", async () => {
    const owner = t.users.owner;
    expect(await canConfirmDrafts(t.db, manager().id)).toBe(true);
    await expect(setConfirmer(t.db, manager(), owner.id, true)).rejects.toThrow(ForbiddenError);
    await expect(setConfirmer(t.db, owner, t.users.location_lead.id, true)).rejects.toThrow(
      "менеджери й власник",
    );

    await setConfirmer(t.db, owner, owner.id, true);
    expect(await canConfirmDrafts(t.db, owner.id)).toBe(true);
    expect(await canConfirmDrafts(t.db, manager().id)).toBe(false);
    const { orderId } = await telegramDraft("лише для підтверджувачів");
    await expect(confirmIntakeDraft(t.db, manager(), orderId)).rejects.toThrow(ForbiddenError);
    expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
      "draft",
    );
    // Відхилити можна й не підтверджувачу.
    await rejectIntakeDraft(t.db, manager(), orderId);

    await setConfirmer(t.db, owner, manager().id, true);
    await setConfirmer(t.db, owner, owner.id, false);
    const second = await telegramDraft("тепер менеджер");
    await confirmIntakeDraft(t.db, manager(), second.orderId);
    await setConfirmer(t.db, owner, manager().id, false);
    expect(await canConfirmDrafts(t.db, owner.id)).toBe(true);
  });
});
