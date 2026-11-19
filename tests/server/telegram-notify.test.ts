import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as dailyPost } from "@/app/api/cron/daily-report/route";
import { cashEntries, clients, intakeMessages, locations, profiles, settings } from "@/db/schema";
import { transitionOrder } from "@/server/order-status";
import { updateOrder } from "@/server/orders";
import { receiveSiteLead } from "@/server/intake/site-lead";
import { handleCallback, callbackData, processAndReply } from "@/server/intake/telegram-flow";
import type { ParseResult } from "@/server/intake/schema";
import {
  collectDaySummary,
  formatDaySummary,
  runDailyReport,
} from "@/server/telegram/daily-report";
import {
  sendChangedTodayNotice,
  sendConfirmedNotice,
  sendNoClientNotice,
  sendSiteLeadNotice,
} from "@/server/telegram/notify";
import { setTelegramSettings } from "@/server/telegram/settings";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const NOW = new Date("2034-09-02T19:30:00Z"); // 22:30 за Києвом
const DAY = "2034-09-02";

describe("сповіщення менеджерам і вечірнє зведення (B11, PR 5)", () => {
  let t: OrderTestContext;
  const sent: { chatId: number; text: string }[] = [];
  const send = async (chatId: number, text: string) => {
    sent.push({ chatId, text });
  };
  const owner = () => t.users.owner;
  const manager = () => t.users.manager;
  const OWNER_TG = 7001;
  const MANAGER_TG = 7002;

  beforeAll(async () => {
    t = await setupOrderTests();
    await t.db
      .update(profiles)
      .set({ telegramUserId: OWNER_TG })
      .where(eq(profiles.id, owner().id));
    await t.db
      .update(profiles)
      .set({ telegramUserId: MANAGER_TG })
      .where(eq(profiles.id, manager().id));
    await t.db.update(clients).set({ managerId: manager().id }).where(eq(clients.id, t.client.id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("підтвердив інший: менеджер клієнта отримує повідомлення, а свій власний підтверджений не отримує", async () => {
    const order = await t.create({ orderDate: DAY });
    await transitionOrder(t.db, owner(), order.id, "confirmed");
    sent.length = 0;
    expect(await sendConfirmedNotice(t.db, order.id, owner().id, { send })).toBe(1);
    expect(sent[0]!.chatId).toBe(MANAGER_TG);
    expect(sent[0]!.text).toContain("Підтверджено замовлення");
    expect(sent[0]!.text).toContain("Кафе Тест");
    // Підтвердив сам менеджер: не повідомляємо.
    expect(await sendConfirmedNotice(t.db, order.id, manager().id, { send })).toBe(0);
  });

  it("менеджер без прив'язки Telegram чи вимкнений: повідомлення не йде, помилки немає", async () => {
    const order = await t.create({ orderDate: DAY });
    await t.db.update(profiles).set({ telegramUserId: null }).where(eq(profiles.id, manager().id));
    expect(await sendConfirmedNotice(t.db, order.id, owner().id, { send })).toBe(0);
    await t.db
      .update(profiles)
      .set({ telegramUserId: MANAGER_TG })
      .where(eq(profiles.id, manager().id));
  });

  it("збій відправки одному не ламає: повертає 0 і не кидає помилку", async () => {
    const order = await t.create({ orderDate: DAY });
    const failing = async () => {
      throw new Error("blocked");
    };
    expect(await sendConfirmedNotice(t.db, order.id, owner().id, { send: failing })).toBe(0);
  });

  it("зміна замовлення на сьогодні сповіщає менеджера клієнта, на інший день і чернетку ні", async () => {
    const today = await t.create({ orderDate: DAY });
    await transitionOrder(t.db, owner(), today.id, "confirmed");
    await updateOrder(t.db, owner(), today.id, { comment: "змінено" });
    sent.length = 0;
    expect(await sendChangedTodayNotice(t.db, today.id, owner().id, { send, now: NOW })).toBe(1);
    expect(sent[0]!.text).toContain("на сьогодні");
    // Інший день.
    expect(
      await sendChangedTodayNotice(t.db, today.id, owner().id, {
        send,
        now: new Date("2034-09-05T10:00:00Z"),
      }),
    ).toBe(0);
    // Чернетка.
    const draft = await t.create({ orderDate: DAY });
    expect(await sendChangedTodayNotice(t.db, draft.id, owner().id, { send, now: NOW })).toBe(0);
    // Змінив сам менеджер.
    expect(await sendChangedTodayNotice(t.db, today.id, manager().id, { send, now: NOW })).toBe(0);
  });

  it("заявка з сайту: невідомий клієнт іде власнику й менеджерам з Telegram, відомий його менеджеру й власнику", async () => {
    const lead = await receiveSiteLead(t.db, {
      lead: { name: "Невідомий", phone: "+380679990001", delivery: "Самовивіз" },
      receivedAt: "2034-08-10T09:00:00Z",
    });
    if (!lead.ok) throw new Error(lead.error);
    sent.length = 0;
    await sendSiteLeadNotice(t.db, lead.draftId, { send });
    const chats = sent.map((m) => m.chatId).sort();
    expect(chats).toEqual([OWNER_TG, MANAGER_TG].sort());
    expect(sent[0]!.text).toContain("Нова заявка з сайту");
    expect(sent[0]!.text).toContain("клієнта ще не визначено");
  });

  it("чернетка без клієнта з Telegram: автору приходить окреме повідомлення", async () => {
    const [kyiv] = await t.db.select().from(locations).where(eq(locations.code, "kyiv"));
    const row = (
      await t.db
        .insert(intakeMessages)
        .values({
          telegramChatId: -1,
          telegramMessageId: 99001,
          telegramUserId: MANAGER_TG,
          locationId: kyiv!.id,
          text: "хтось завтра 20 кг",
        })
        .returning()
    )[0]!;
    const result: ParseResult = {
      client: { code: null, name_guess: "Хтось", confidence: 0.1 },
      order_date: DAY,
      kg_sold: 20,
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
    };
    sent.length = 0;
    const outcome = await processAndReply(t.db, row.id, {
      send: async (params) => {
        sent.push({ chatId: params.chatId, text: params.text });
      },
      claude: async () => ({
        result,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: "m",
      }),
    });
    expect(outcome.status).toBe("drafted");
    const personal = sent.find((m) => m.chatId === MANAGER_TG);
    expect(personal?.text).toContain("без клієнта");
    if (outcome.status === "drafted") {
      expect(await sendNoClientNotice(t.db, outcome.orderId, MANAGER_TG, { send })).toBe(true);
    }
  });

  it("кнопка «Підтвердити» в Telegram: менеджер клієнта отримує повідомлення, коли підтвердив власник", async () => {
    const draft = await t.create({ orderDate: DAY });
    sent.length = 0;
    const outcome = await handleCallback(
      t.db,
      {
        id: "cb1",
        from: { id: OWNER_TG },
        data: callbackData(draft.id, "confirm"),
        message: { message_id: 5, chat: { id: -1 } },
      },
      {
        send: async (params) => {
          sent.push({ chatId: params.chatId, text: params.text });
        },
        edit: async () => undefined,
        answer: async () => undefined,
      },
    );
    expect(outcome.kind).toBe("confirmed");
    expect(sent.some((m) => m.chatId === MANAGER_TG && m.text.includes("Підтверджено"))).toBe(true);
  });

  describe("вечірнє зведення", () => {
    it("підсумки дня: замовлення, кг, готівка без сторно", async () => {
      const order = await t.create({ orderDate: DAY, kgSold: 40 });
      await transitionOrder(t.db, owner(), order.id, "confirmed");
      const base = {
        orderId: order.id,
        locationId: t.location,
        receivedOn: DAY,
        enteredBy: owner().id,
        enteredVia: "web" as const,
      };
      await t.db.insert(cashEntries).values({ ...base, amount: "100.00" });
      await t.db.insert(cashEntries).values({
        ...base,
        amount: "50.00",
        reversedAt: NOW,
        reversedBy: owner().id,
        reversalReason: "помилка",
      });
      const rows = await collectDaySummary(t.db, DAY);
      const row = rows.find((r) => r.locationId === t.location)!;
      expect(row.orders).toBeGreaterThanOrEqual(1);
      expect(row.kg).toBeGreaterThanOrEqual(40);
      expect(row.cash).toBe(100);
      const text = formatDaySummary(DAY, rows, "https://x/production");
      expect(text).toContain("Підсумок дня");
      expect(text).toContain("готівкою отримано 100");
    });

    it("порожній день: короткий текст", () => {
      const text = formatDaySummary(DAY, [
        { locationId: "a", name: "Київ", orders: 0, kg: 0, shipped: 0, cash: 0, boxesIssued: 0 },
      ]);
      expect(text).toContain("не було");
    });

    it("до заданого часу не йде, потім один раз на день, без чату власника не йде", async () => {
      const reports: { chatId: number; text: string }[] = [];
      const capture = async (chatId: number, text: string) => {
        reports.push({ chatId, text });
      };
      // Налаштування 18:00; зараз 17:00 за Києвом.
      const early = new Date("2034-09-02T14:00:00Z");
      expect(await runDailyReport(t.db, { now: early, send: capture })).toEqual({
        sent: false,
        reason: "not_yet",
      });
      expect(await runDailyReport(t.db, { now: NOW, send: capture })).toEqual({
        sent: false,
        reason: "no_chat",
      });
      await setTelegramSettings(t.db, owner().id, { ownerChatId: 8800 });
      expect(await runDailyReport(t.db, { now: NOW, send: capture })).toEqual({
        sent: true,
        day: DAY,
      });
      expect(reports).toHaveLength(1);
      expect(reports[0]!.chatId).toBe(8800);
      // Другий виклик того ж дня: нічого.
      expect(await runDailyReport(t.db, { now: NOW, send: capture })).toEqual({
        sent: false,
        reason: "already",
      });
      expect(reports).toHaveLength(1);
      // Наступного дня знову йде.
      const next = new Date("2034-09-03T19:30:00Z");
      expect((await runDailyReport(t.db, { now: next, send: capture })).sent).toBe(true);
      expect(reports).toHaveLength(2);
    });

    it("час із налаштування: 23:00 пізніше за 22:30", async () => {
      await t.db
        .update(settings)
        .set({ value: "23:00" })
        .where(eq(settings.key, "report.daily_time"));
      const next = new Date("2034-09-04T19:30:00Z");
      expect(await runDailyReport(t.db, { now: next, send: async () => undefined })).toEqual({
        sent: false,
        reason: "not_yet",
      });
      await t.db
        .update(settings)
        .set({ value: "18:00" })
        .where(eq(settings.key, "report.daily_time"));
    });

    it("збій відправки звільняє спробу: наступний виклик повторить", async () => {
      const day = new Date("2034-09-10T19:30:00Z");
      const failing = async () => {
        throw new Error("net");
      };
      expect(await runDailyReport(t.db, { now: day, send: failing })).toEqual({
        sent: false,
        reason: "failed",
      });
      expect((await runDailyReport(t.db, { now: day, send: async () => undefined })).sent).toBe(
        true,
      );
    });

    it("адреса розкладу без секрету: 401", async () => {
      const response = await dailyPost(
        new Request("http://x/api/cron/daily-report", { method: "POST" }),
      );
      expect(response.status).toBe(401);
    });
  });
});
