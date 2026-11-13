import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderStatusHistory, orders } from "@/db/schema";
import { findForbiddenFields } from "@/server/dto";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import {
  AUTO_START_NOTE,
  autoStartProduction,
  listProductionQueue,
  markOrdersSeen,
} from "@/server/production";
import { addDays } from "@/utils/isoDate";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

const TOMORROW = "2026-11-14";

describe("екран виробництва: черга, «Нове», автозапуск, «Повернути в роботу» (B6, D63–D65, D72, D73)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const history = async (id: string) =>
    (await t.db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id))).sort(
      (a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
    );

  type Until = "draft" | "confirmed" | "in_production" | "packed";
  const order = async (
    until: Until,
    overrides: Parameters<typeof t.create>[0] = {},
    actor = t.users.manager,
  ) => {
    const { id } = await t.create(overrides, actor);
    if (until === "draft") return id;
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    if (until === "confirmed") return id;
    const lead = overrides.locationId === t.otherLocation ? t.otherLead : t.users.location_lead;
    await transitionOrder(t.db, lead, id, "in_production");
    if (until === "in_production") return id;
    await transitionOrder(t.db, lead, id, "packed");
    return id;
  };

  /** Окрема дата для кожного тесту, щоб черги не змішувались. */
  let day = 0;
  const freshDate = () => addDays("2027-01-10", ++day);

  describe("черга на день", () => {
    it("бачить підтверджені, у роботі й запаковані; чернетки, скасовані й оплачені ні", async () => {
      const date = freshDate();
      const confirmed = await order("confirmed", { orderDate: date });
      const working = await order("in_production", { orderDate: date });
      const packed = await order("packed", { orderDate: date });
      await order("draft", { orderDate: date });
      const cancelled = await order("confirmed", { orderDate: date });
      await transitionOrder(t.db, t.users.owner, cancelled, "cancelled", { note: "Тест" });
      await order("confirmed", { orderDate: "2030-01-01" });

      const queue = await listProductionQueue(t.db, t.users.production, { date });
      expect(queue.cards.map((c) => c.id).sort()).toEqual([confirmed, working, packed].sort());
      expect(queue.cards.map((c) => c.status).sort()).toEqual(
        ["confirmed", "in_production", "packed"].sort(),
      );
    });

    it("картка має все, що потрібно цеху, і нічого зайвого", async () => {
      const date = freshDate();
      const id = await order(
        "confirmed",
        {
          orderDate: date,
          kgSold: 30,
          deliveryMethod: "our_delivery",
          deliveryText: "Київ, вул. Сагайдачного, 12",
          timeWindow: "10:00-14:00",
          comment: "Пакувати в два бокси",
          recipientPhone: "+380501234567",
        },
        t.users.owner,
      );
      const [card] = (await listProductionQueue(t.db, t.users.production, { date })).cards;
      expect(card).toMatchObject({
        id,
        status: "confirmed",
        clientName: "Кафе Тест",
        iceTypeName: "16 мм",
        kgSold: "30.000",
        kgToProduce: "30.000",
        deliveryPlace: "Київ, вул. Сагайдачного, 12",
        timeWindow: "10:00-14:00",
        comment: "Пакувати в два бокси",
        isNew: true,
      });
      const json = JSON.stringify(card);
      for (const secret of [
        "+380501234567",
        "internalComment",
        "recipientPhone",
        "paymentKind",
        "pricePerKg",
        "total",
        "amount",
        "price",
      ]) {
        expect(json, secret).not.toContain(secret);
      }
    });

    it("порядок: нові, потім за вікном, запаковані внизу; лічильник «нових» і підсумок за льодом", async () => {
      const date = freshDate();
      const late = await order("in_production", {
        orderDate: date,
        timeWindow: "16:00",
        kgSold: 10,
      });
      const early = await order("in_production", {
        orderDate: date,
        timeWindow: "09:00",
        kgSold: 20,
      });
      const done = await order("packed", { orderDate: date, timeWindow: "08:00", kgSold: 5 });
      await markOrdersSeen(t.db, t.users.location_lead, { date });
      const fresh = await order("confirmed", { orderDate: date, timeWindow: "18:00", kgSold: 40 });

      const queue = await listProductionQueue(t.db, t.users.production, { date });
      expect(queue.cards.map((c) => c.id)).toEqual([fresh, early, late, done]);
      expect(queue.newCount).toBe(1);
      expect(queue.summary).toMatchObject({ notStarted: 1, notPacked: 3 });
      expect(queue.summary.byIce[0]).toMatchObject({
        iceTypeName: "16 мм",
        kgPlanned: 75,
        kgLeft: 70,
        orders: 4,
      });
    });

    it("порожній день дає порожню чергу", async () => {
      const queue = await listProductionQueue(t.db, t.users.production, { date: freshDate() });
      expect(queue).toMatchObject({ cards: [], newCount: 0 });
      expect(queue.summary.byIce).toEqual([]);
    });

    it("Нова Пошта: місто й відділення з адреси клієнта; самовивіз", async () => {
      const date = freshDate();
      const pickup = await order("confirmed", { orderDate: date, deliveryMethod: "pickup" });
      const queue = await listProductionQueue(t.db, t.users.production, { date });
      expect(queue.cards.find((c) => c.id === pickup)?.deliveryPlace).toBe("Самовивіз");
    });
  });

  describe("локація і права на читання", () => {
    it("виробництво й старший локації бачать лише свою локацію; чужі замовлення не потрапляють", async () => {
      const date = freshDate();
      const mine = await order("confirmed", { orderDate: date });
      const foreign = await order("confirmed", { orderDate: date, locationId: t.otherLocation });
      for (const [actor, ids] of [
        [t.users.production, [mine]],
        [t.users.location_lead, [mine]],
        [t.otherProduction, [foreign]],
        [t.otherLead, [foreign]],
      ] as const) {
        const queue = await listProductionQueue(t.db, actor, { date });
        expect(
          queue.cards.map((c) => c.id),
          actor.role,
        ).toEqual(ids);
      }
    });

    it("виробництво не може підмінити локацію параметром", async () => {
      const date = freshDate();
      await order("confirmed", { orderDate: date });
      const foreign = await order("confirmed", { orderDate: date, locationId: t.otherLocation });
      const queue = await listProductionQueue(t.db, t.otherProduction, {
        date,
        locationId: t.location,
      });
      expect(queue.cards.map((c) => c.id)).toEqual([foreign]);
    });

    it("власник і менеджер обирають локацію або бачать усі; бухгалтер і водій не мають екрана", async () => {
      const date = freshDate();
      const a = await order("confirmed", { orderDate: date });
      const b = await order("confirmed", { orderDate: date, locationId: t.otherLocation });
      for (const actor of [t.users.owner, t.users.manager]) {
        expect(
          (await listProductionQueue(t.db, actor, { date, locationId: t.location })).cards.map(
            (c) => c.id,
          ),
        ).toEqual([a]);
        expect(
          (await listProductionQueue(t.db, actor, { date })).cards.map((c) => c.id).sort(),
        ).toEqual([a, b].sort());
      }
      for (const role of ["accountant", "driver"] as const) {
        await expect(listProductionQueue(t.db, t.users[role], { date })).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });

    it("некоректна дата відхиляється", async () => {
      await expect(
        listProductionQueue(t.db, t.users.production, { date: "завтра" }),
      ).rejects.toThrow("Некоректна дата");
    });
  });

  describe("жодних цін і сум у відповідях цеху (ТЗ 2.2, критерій приймання 2)", () => {
    it("для кожної ролі, що читає екран, у відповіді немає заборонених полів", async () => {
      const date = freshDate();
      await order("confirmed", { orderDate: date, kgSold: 30, comment: "Коментар" });
      await order("in_production", { orderDate: date, deliveryMethod: "np" });
      for (const role of ["owner", "manager", "location_lead", "production"] as const) {
        const queue = await listProductionQueue(t.db, t.users[role], { date });
        expect(queue.cards.length, role).toBeGreaterThan(0);
        expect(findForbiddenFields(queue, role), role).toEqual([]);
        // Навіть власнику й менеджеру екран цеху грошей не показує.
        expect(JSON.stringify(queue), role).not.toMatch(/price|amount|total|cash|payment/i);
      }
    });
  });

  describe("«Нове» (D65)", () => {
    it("нове, поки цех не бачив; після «позначити побаченими» ні", async () => {
      const date = freshDate();
      await order("confirmed", { orderDate: date });
      await order("confirmed", { orderDate: date });
      expect((await listProductionQueue(t.db, t.users.production, { date })).newCount).toBe(2);
      const result = await markOrdersSeen(t.db, t.users.production, { date });
      expect(result.marked).toBe(2);
      expect((await listProductionQueue(t.db, t.users.production, { date })).newCount).toBe(0);
      expect((await markOrdersSeen(t.db, t.users.production, { date })).marked).toBe(0);
    });

    it("можна позначити лише вказані замовлення", async () => {
      const date = freshDate();
      const first = await order("confirmed", { orderDate: date });
      const second = await order("confirmed", { orderDate: date });
      await markOrdersSeen(t.db, t.users.location_lead, { date, orderIds: [first] });
      expect((await row(first)).seenByProductionAt).toBeInstanceOf(Date);
      expect((await row(second)).seenByProductionAt).toBeNull();
      expect(
        (await markOrdersSeen(t.db, t.users.location_lead, { date, orderIds: [] })).marked,
      ).toBe(0);
    });

    it("чужу локацію не чіпає", async () => {
      const date = freshDate();
      const foreign = await order("confirmed", { orderDate: date, locationId: t.otherLocation });
      await markOrdersSeen(t.db, t.users.production, { date });
      expect((await row(foreign)).seenByProductionAt).toBeNull();
    });

    it("власник, менеджер, бухгалтер і водій «Нове» не знімають", async () => {
      const date = freshDate();
      const id = await order("confirmed", { orderDate: date });
      for (const role of ["owner", "manager", "accountant", "driver"] as const) {
        await expect(markOrdersSeen(t.db, t.users[role], { date }), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      expect((await row(id)).seenByProductionAt).toBeNull();
    });
  });

  describe("автоматичне «У виробництві» (ТЗ 5.1, D72)", () => {
    it("цех запускає підтверджені на сьогодні своєї локації; завтрашні, чужі й чернетки ні", async () => {
      const today = freshDate();
      const mine = await order("confirmed", { orderDate: today });
      const tomorrow = await order("confirmed", { orderDate: TOMORROW });
      const foreign = await order("confirmed", { orderDate: today, locationId: t.otherLocation });
      const draft = await order("draft", { orderDate: today });
      const working = await order("in_production", { orderDate: today });

      const result = await autoStartProduction(t.db, t.users.production, today);
      expect(result.started).toBe(1);
      expect((await row(mine)).status).toBe("in_production");
      expect((await row(tomorrow)).status).toBe("confirmed");
      expect((await row(foreign)).status).toBe("confirmed");
      expect((await row(draft)).status).toBe("draft");
      expect((await row(working)).status).toBe("in_production");
    });

    it("в історії лишається автор і примітка про автозапуск", async () => {
      const today = freshDate();
      const id = await order("confirmed", { orderDate: today });
      await autoStartProduction(t.db, t.users.location_lead, today);
      const last = (await history(id)).at(-1)!;
      expect(last).toMatchObject({
        fromStatus: "confirmed",
        toStatus: "in_production",
        changedBy: t.users.location_lead.id,
        note: AUTO_START_NOTE,
      });
    });

    it("повторне відкриття нічого не запускає вдруге", async () => {
      const today = freshDate();
      await order("confirmed", { orderDate: today });
      expect((await autoStartProduction(t.db, t.users.production, today)).started).toBe(1);
      expect((await autoStartProduction(t.db, t.users.production, today)).started).toBe(0);
    });

    it("двоє відкривають екран одночасно: кожне замовлення запускається один раз", async () => {
      const today = freshDate();
      await order("confirmed", { orderDate: today });
      await order("confirmed", { orderDate: today });
      const [a, b] = await Promise.all([
        autoStartProduction(t.db, t.users.production, today),
        autoStartProduction(t.db, t.users.location_lead, today),
      ]);
      expect(a.started + b.started).toBe(2);
    });

    it("власник, менеджер, бухгалтер і водій екран не запускають", async () => {
      const today = freshDate();
      const id = await order("confirmed", { orderDate: today });
      for (const role of ["owner", "manager", "accountant", "driver"] as const) {
        await expect(autoStartProduction(t.db, t.users[role], today), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      expect((await row(id)).status).toBe("confirmed");
    });

    it("ручне «Розпочати» працює для завтрашнього замовлення", async () => {
      const id = await order("confirmed", { orderDate: TOMORROW });
      await transitionOrder(t.db, t.users.production, id, "in_production");
      expect((await row(id)).status).toBe("in_production");
    });
  });

  describe("«Готово» і «Повернути в роботу» (ТЗ 6.4, D73)", () => {
    it("виробництво й старший локації позначають «Запаковано» у своїй локації", async () => {
      const a = await order("in_production", { orderDate: freshDate() });
      await transitionOrder(t.db, t.users.production, a, "packed");
      expect((await row(a)).status).toBe("packed");
      const foreign = await order("in_production", {
        orderDate: freshDate(),
        locationId: t.otherLocation,
      });
      await expect(
        transitionOrder(t.db, t.users.production, foreign, "packed"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("старший локації повертає запаковане в роботу з приміткою; без примітки ні", async () => {
      const id = await order("packed", { orderDate: freshDate() });
      await expect(
        transitionOrder(t.db, t.users.location_lead, id, "in_production"),
      ).rejects.toThrow("Вкажіть, чому");
      await transitionOrder(t.db, t.users.location_lead, id, "in_production", {
        note: "Натиснули «Готово» помилково",
      });
      const order_ = await row(id);
      expect(order_.status).toBe("in_production");
      expect(order_.packedAt).toBeNull();
      expect((await history(id)).at(-1)).toMatchObject({
        fromStatus: "packed",
        toStatus: "in_production",
        changedBy: t.users.location_lead.id,
        note: "Натиснули «Готово» помилково",
      });
    });

    it("виробництво, менеджер, бухгалтер, водій і старший чужої локації повернути не можуть", async () => {
      const id = await order("packed", { orderDate: freshDate() });
      for (const actor of [
        t.users.production,
        t.users.manager,
        t.users.accountant,
        t.users.driver,
        t.otherLead,
      ]) {
        await expect(
          transitionOrder(t.db, actor, id, "in_production", { note: "Спроба" }),
          actor.role,
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect((await row(id)).status).toBe("packed");
    });

    it("інші кроки назад старшому локації недоступні", async () => {
      const id = await order("in_production", { orderDate: freshDate() });
      await expect(
        transitionOrder(t.db, t.users.location_lead, id, "confirmed", { note: "Спроба" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("усі шість ролей перевірено: матриця екрана виробництва", async () => {
    const date = ORDER_DATE;
    const outcome: Record<string, boolean> = {};
    for (const role of USER_ROLES) {
      outcome[role] = await listProductionQueue(t.db, t.users[role], { date }).then(
        () => true,
        () => false,
      );
    }
    expect(outcome).toEqual({
      owner: true,
      manager: true,
      location_lead: true,
      production: true,
      accountant: false,
      driver: false,
    });
  });
});
