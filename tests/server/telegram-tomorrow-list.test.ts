import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locations } from "@/db/schema";
import { transitionOrder } from "@/server/order-status";
import { setTelegramSettings } from "@/server/telegram/settings";
import {
  collectTomorrow,
  formatTomorrowList,
  nextKyivDay,
  runTomorrowList,
} from "@/server/telegram/tomorrow-list";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const TODAY = "2034-09-02";
const TOMORROW = "2034-09-03";
// 18:30 за Києвом (літо, UTC+3).
const EVENING = new Date("2034-09-02T15:30:00Z");

describe("список замовлень на завтра о 18:00 для Києва (B11, D160)", () => {
  let t: OrderTestContext;
  let kyivId: string;
  beforeAll(async () => {
    t = await setupOrderTests();
    kyivId = (await t.db.select().from(locations).where(eq(locations.code, "kyiv")))[0]!.id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const make = async (
    overrides: Parameters<OrderTestContext["create"]>[0],
    status: "draft" | "confirmed" | "cancelled" = "confirmed",
  ) => {
    const order = await t.create({ orderDate: TOMORROW, locationId: kyivId, ...overrides });
    if (status === "confirmed") await transitionOrder(t.db, t.users.owner, order.id, "confirmed");
    if (status === "cancelled")
      await transitionOrder(t.db, t.users.owner, order.id, "cancelled", { note: "тест" });
    return order;
  };

  it("наступний день за календарем", () => {
    expect(nextKyivDay("2034-09-30")).toBe("2034-10-01");
    expect(nextKyivDay("2034-12-31")).toBe("2035-01-01");
  });

  it("список: підтверджені за часом, чернетки лише числом, скасовані й інші дні не потрапляють", async () => {
    await make({ timeWindow: "14:00", kgSold: 50, deliveryMethod: "pickup" });
    await make({
      timeWindow: "09:00-11:00",
      kgSold: 30,
      deliveryMethod: "our_delivery",
      deliveryText: "Київ, Оболонь",
    });
    await make({ kgSold: 10 }, "draft");
    await make({ kgSold: 99 }, "cancelled");
    await t.create({ orderDate: TODAY, locationId: kyivId });

    const data = await collectTomorrow(t.db, TOMORROW);
    expect(data.rows).toHaveLength(2);
    expect(data.drafts).toBe(1);
    expect(data.rows[0]!.timeWindow).toBe("09:00-11:00");

    const text = formatTomorrowList(TOMORROW, data);
    expect(text).toContain("Замовлення на завтра");
    expect(text).toContain("1. Кафе Тест · 30 кг · 09:00-11:00 · Наша доставка, Київ, Оболонь");
    expect(text).toContain("2. Кафе Тест · 50 кг · 14:00 · самовивіз");
    expect(text).toContain("Разом: 2 замовл., 80 кг.");
    expect(text).toContain("Чекають підтвердження: 1.");
  });

  it("порожній день", () => {
    expect(formatTomorrowList(TOMORROW, { rows: [], drafts: 0 })).toContain(
      "Підтверджених замовлень поки немає.",
    );
  });

  it("до 18:00 не йде, без топіка не йде, потім один раз на день у топік «Київ»", async () => {
    const sent: { chatId: number; threadId: number; text: string }[] = [];
    const send = async (chatId: number, threadId: number, text: string) => {
      sent.push({ chatId, threadId, text });
    };
    const early = new Date("2034-09-02T14:00:00Z"); // 17:00 за Києвом
    expect(await runTomorrowList(t.db, { now: early, send })).toEqual({
      sent: false,
      reason: "not_yet",
    });
    expect(await runTomorrowList(t.db, { now: EVENING, send })).toEqual({
      sent: false,
      reason: "no_topic",
    });
    await setTelegramSettings(t.db, t.users.owner.id, { groupChatId: -1009, topicKyiv: 77 });
    expect(await runTomorrowList(t.db, { now: EVENING, send })).toEqual({
      sent: true,
      day: TOMORROW,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: -1009, threadId: 77 });
    expect(await runTomorrowList(t.db, { now: EVENING, send })).toEqual({
      sent: false,
      reason: "already",
    });
    expect(sent).toHaveLength(1);
  });

  it("збій відправки звільняє спробу: наступний виклик повторить", async () => {
    const later = new Date("2034-09-10T15:30:00Z");
    const failing = async () => {
      throw new Error("net");
    };
    expect(await runTomorrowList(t.db, { now: later, send: failing })).toEqual({
      sent: false,
      reason: "failed",
    });
    expect((await runTomorrowList(t.db, { now: later, send: async () => undefined })).sent).toBe(
      true,
    );
  });
});
