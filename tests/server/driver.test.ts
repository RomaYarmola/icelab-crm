import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cashEntries, orders, profiles, telegramSessions } from "@/db/schema";
import { driverMarkDelivered, driverRecordCash, listDriverOrders } from "@/server/driver";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { clearSession, getSession, setSession } from "@/server/telegram/sessions";
import { driverCardText, handleDriverMessage } from "@/server/telegram/driver-flow";
import { handleUpdate } from "@/server/telegram/updates";
import { todayIso } from "@/utils/isoDate";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const TG = 7001;
const CHAT = 7001;

describe("водій: доставки дня, «Доставив», готівка через бота (B12)", () => {
  let t: OrderTestContext;
  const sent: { chatId: number; text: string; buttons?: unknown; forceReply?: string }[] = [];
  const answers: string[] = [];
  const deps = {
    send: async (p: (typeof sent)[number]) => {
      sent.push(p);
    },
    answer: async (p: { text?: string }) => {
      answers.push(p.text ?? "");
    },
  };

  beforeAll(async () => {
    t = await setupOrderTests();
    await t.db
      .update(profiles)
      .set({ telegramUserId: TG })
      .where(eq(profiles.id, t.users.driver.id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    sent.length = 0;
    answers.length = 0;
    await t.db.delete(telegramSessions);
  });

  const delivery = async (
    until: "confirmed" | "packed" = "packed",
    overrides: Parameters<typeof t.create>[0] = {},
  ) => {
    const { id } = await t.create({
      orderDate: todayIso(),
      deliveryMethod: "our_delivery",
      deliveryText: "вул. Хрещатик, 1",
      timeWindow: "10-12",
      paymentKind: "cash",
      ...overrides,
    });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    if (until === "packed") {
      await transitionOrder(t.db, t.users.location_lead, id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, id, "packed");
    }
    return id;
  };
  const status = async (id: string) =>
    (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.status;

  it("перелік: лише власна доставка своєї локації на сьогодні, із сумою готівки", async () => {
    const mine = await delivery();
    await t.create({ orderDate: todayIso(), deliveryMethod: "pickup" });
    await delivery("packed", { orderDate: "2030-01-01" });
    const list = await listDriverOrders(t.db, t.users.driver);
    expect(list.map((o) => o.id)).toContain(mine);
    const order = list.find((o) => o.id === mine)!;
    expect(order).toMatchObject({
      canDeliver: true,
      cashDue: "2250.00",
      place: "вул. Хрещатик, 1",
      timeWindow: "10-12",
    });
    expect(list.every((o) => o.status !== undefined)).toBe(true);
    expect(JSON.stringify(list)).not.toContain("pricePerKg");
    expect(driverCardText(order)).toContain("очікується");
  });

  it("не водій і водій без локації отримують відмову", async () => {
    await expect(listDriverOrders(t.db, t.users.manager)).rejects.toBeInstanceOf(ForbiddenError);
    const id = await delivery();
    await expect(driverMarkDelivered(t.db, t.users.manager, id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("чужа локація: водій не бачить і не чіпає", async () => {
    const id = await delivery();
    const foreign = { ...t.users.driver, locationId: t.otherLocation };
    expect(await listDriverOrders(t.db, foreign)).toEqual([]);
    await expect(driverMarkDelivered(t.db, foreign, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(driverRecordCash(t.db, foreign, id, "10")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("«Доставив»: Запаковано → Відправлено; повторно нічого не змінює; не запаковане відхиляє", async () => {
    const early = await delivery("confirmed");
    await expect(driverMarkDelivered(t.db, t.users.driver, early)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const id = await delivery();
    expect(await driverMarkDelivered(t.db, t.users.driver, id)).toMatchObject({
      already: false,
      askCash: true,
      cashDue: "2250.00",
    });
    expect(await status(id)).toBe("shipped");
    expect(await driverMarkDelivered(t.db, t.users.driver, id)).toMatchObject({ already: true });
  });

  it("не готівкова оплата: про готівку не питаємо", async () => {
    const id = await delivery("packed", { paymentKind: "fop" });
    expect(await driverMarkDelivered(t.db, t.users.driver, id)).toMatchObject({ askCash: false });
  });

  it("готівка: «450 грн» записується як бот водія; помилки вводу пояснюються", async () => {
    const id = await delivery();
    await driverMarkDelivered(t.db, t.users.driver, id);
    for (const bad of ["abc", "0", "-5", "", "99999"]) {
      await expect(driverRecordCash(t.db, t.users.driver, id, bad), bad).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const result = await driverRecordCash(t.db, t.users.driver, id, "450 грн");
    expect(result).toMatchObject({ remainingSum: "1800.00", settled: false });
    const [entry] = await t.db.select().from(cashEntries).where(eq(cashEntries.orderId, id));
    expect(entry).toMatchObject({
      enteredVia: "driver_bot",
      receivedByText: t.users.driver.fullName,
    });
    const rest = await driverRecordCash(t.db, t.users.driver, id, "1800,00");
    expect(rest.settled).toBe(true);
  });

  it("діалоги: збереження, заміна, очищення, застарілий вважається відсутнім", async () => {
    await setSession(t.db, 1, "a", { x: 1 });
    await setSession(t.db, 1, "b", { y: 2 });
    expect(await getSession(t.db, 1)).toMatchObject({ state: "b", payload: { y: 2 } });
    expect(await getSession(t.db, 1, new Date(Date.now() + 25 * 3_600_000))).toBeNull();
    await clearSession(t.db, 1);
    expect(await getSession(t.db, 1)).toBeNull();
  });

  describe("бот", () => {
    const say = (text: string) =>
      handleUpdate(
        t.db,
        {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: CHAT, type: "private" },
            from: { id: TG },
            text,
          },
        },
        deps,
      );
    const press = (data: string) =>
      handleUpdate(
        t.db,
        {
          update_id: 2,
          callback_query: {
            id: "cb",
            from: { id: TG },
            data,
            message: { message_id: 5, chat: { id: CHAT } },
          },
        },
        deps,
      );

    it("/today показує картки, «Доставив» питає готівку, відповідь записується", async () => {
      const id = await delivery();
      await say("/today");
      expect(sent.some((m) => m.text.includes("Хрещатик") && Boolean(m.buttons))).toBe(true);

      sent.length = 0;
      await press(`drv:${id}:done`);
      expect(await status(id)).toBe("shipped");
      expect(sent.at(-1)).toMatchObject({ forceReply: expect.any(String) });

      await say("abc");
      expect(sent.at(-1)!.text).toContain("числом");
      expect(await getSession(t.db, TG)).not.toBeNull();

      await say("2250");
      expect(sent.at(-1)!.text).toContain("оплачене");
      expect(await getSession(t.db, TG)).toBeNull();
      expect(await status(id)).toBe("closed");
    });

    it("повторне «Доставив» і «Готівку не брали» безпечні; чужий Telegram не має доступу", async () => {
      const id = await delivery();
      await press(`drv:${id}:done`);
      await press(`drv:${id}:done`);
      expect(answers.at(-1)).toContain("Уже відмічено");
      await press(`drv:${id}:nocash`);
      expect(await getSession(t.db, TG)).toBeNull();

      const stranger = await handleUpdate(
        t.db,
        {
          update_id: 3,
          callback_query: { id: "x", from: { id: 999 }, data: `drv:${id}:done` },
        },
        deps,
      );
      expect(stranger).toEqual({ kind: "callback", result: "denied" });
    });

    it("текст без діалогу дає підказку", async () => {
      expect(
        await handleDriverMessage(t.db, t.users.driver, { id: TG }, CHAT, "привіт", deps),
      ).toBe("hint");
    });
  });
});
