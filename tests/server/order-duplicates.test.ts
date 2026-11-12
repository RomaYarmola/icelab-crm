import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orders } from "@/db/schema";
import { findForbiddenFields } from "@/server/dto";
import { ForbiddenError } from "@/server/guards";
import { addOrderItem } from "@/server/order-items";
import { findDuplicateOrders, repeatLastOrder } from "@/server/order-duplicates";
import { transitionOrder } from "@/server/order-status";
import { deleteDraftOrder } from "@/server/orders";
import { USER_ROLES } from "@/server/permissions";
import { makeClient } from "../db/helpers";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("дублі замовлень і «як минулого разу» (D56, D57)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const find = (
    overrides: Partial<Parameters<typeof findDuplicateOrders>[2]> = {},
    actor = t.users.manager,
  ) =>
    findDuplicateOrders(t.db, actor, {
      clientId: t.client.id,
      orderDate: ORDER_DATE,
      iceTypeId: t.ice16,
      ...overrides,
    });

  describe("схожі замовлення", () => {
    it("той самий клієнт, дата й тип льоду", async () => {
      const first = await t.create();
      const found = await find();
      expect(found.map((o) => o.id)).toContain(first.id);
      expect(found[0]).toMatchObject({ status: "draft", orderDate: ORDER_DATE });
    });

    it("інша дата, клієнт чи тип льоду не збігаються", async () => {
      await t.create();
      expect(await find({ orderDate: "2026-11-20" })).toEqual([]);
      expect(await find({ iceTypeId: t.ice3 })).toEqual([]);
      const stranger = await makeClient(t.db, { name: "Інший" });
      expect(await find({ clientId: stranger.id })).toEqual([]);
    });

    it("саме замовлення, скасоване й видалене не рахуються", async () => {
      const own = await t.create({ orderDate: "2026-12-01" });
      const cancelled = await t.create({ orderDate: "2026-12-01" });
      await transitionOrder(t.db, t.users.owner, cancelled.id, "cancelled", { note: "х" });
      const removed = await t.create({ orderDate: "2026-12-01" });
      await deleteDraftOrder(t.db, t.users.manager, removed.id);
      const found = await find({ orderDate: "2026-12-01", excludeId: own.id });
      expect(found).toEqual([]);
      expect((await find({ orderDate: "2026-12-01" })).map((o) => o.id)).toEqual([own.id]);
    });

    it("замовлення без типу льоду шукає такі самі", async () => {
      const bare = await t.create({ iceTypeId: null, orderDate: "2026-12-02" });
      expect((await find({ orderDate: "2026-12-02", iceTypeId: null })).map((o) => o.id)).toEqual([
        bare.id,
      ]);
    });

    it("не більше п'яти, нові номери першими", async () => {
      for (let i = 0; i < 7; i++) await t.create({ orderDate: "2026-12-03" });
      const found = await find({ orderDate: "2026-12-03" });
      expect(found).toHaveLength(5);
      const numbers = found.map((o) => o.number!);
      expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
    });

    it("користуються власник і менеджер, решті відмовлено; сміття відхиляється", async () => {
      for (const role of USER_ROLES) {
        const attempt = find({}, t.users[role]);
        if (role === "owner" || role === "manager")
          await expect(attempt, role).resolves.toBeInstanceOf(Array);
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
      await expect(find({ orderDate: "вчора" })).rejects.toThrow("Вкажіть дату");
      await expect(find({ clientId: "ні" })).rejects.toThrow("Некоректний ідентифікатор.");
    });
  });

  describe("«як минулого разу»", () => {
    it("клієнт без замовлень: шаблону немає", async () => {
      const fresh = await makeClient(t.db, { name: "Новачок" });
      expect(await repeatLastOrder(t.db, t.users.manager, fresh.id)).toBeNull();
    });

    it("копіює останнє не скасоване замовлення без дати, цін і «виготовити»", async () => {
      const client = await makeClient(t.db, { name: "Постійний" });
      const old = await t.create({
        clientId: client.id,
        orderDate: "2026-10-01",
        kgSold: 10,
        deliveryMethod: "pickup",
      });
      const last = await t.create({
        clientId: client.id,
        orderDate: "2026-11-05",
        kgSold: 25,
        deliveryMethod: "np",
        recipientName: "Марія",
        recipientPhone: "050 111 22 33",
        timeWindow: "10:00-14:00",
        boxCount: 2,
        paymentKind: "fop",
      });
      await addOrderItem(t.db, t.users.manager, last.id, {
        kind: "delivery",
        title: "Доставка",
        qty: 1,
        price: 150,
      });
      const cancelled = await t.create({
        clientId: client.id,
        orderDate: "2026-11-09",
        kgSold: 99,
      });
      await transitionOrder(t.db, t.users.owner, cancelled.id, "cancelled", { note: "х" });

      const template = await repeatLastOrder(t.db, t.users.manager, client.id);
      expect(template).toMatchObject({
        fromOrderId: last.id,
        fromNumber: last.number,
        iceTypeId: t.ice16,
        kgSold: "25.000",
        deliveryMethod: "np",
        recipientName: "Марія",
        recipientPhone: "+380501112233",
        timeWindow: "10:00-14:00",
        boxCount: 2,
        paymentKind: "fop",
      });
      expect(template?.items).toEqual([
        { kind: "delivery", title: "Доставка", qty: "1.000", unit: "послуга", boxTypeId: null },
      ]);
      for (const forbidden of [
        "orderDate",
        "kgToProduce",
        "price",
        "total",
        "pricePerKgSnapshot",
      ]) {
        expect(template).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(template)).not.toContain(old.id);
      expect(findForbiddenFields(template, "manager")).toEqual([]);
    });

    it("видалену чернетку й чужі замовлення не бере", async () => {
      const client = await makeClient(t.db, { name: "Лише видалене" });
      const removed = await t.create({ clientId: client.id });
      await deleteDraftOrder(t.db, t.users.manager, removed.id);
      expect(await repeatLastOrder(t.db, t.users.manager, client.id)).toBeNull();
      expect((await t.db.select().from(orders).where(eq(orders.clientId, client.id))).length).toBe(
        1,
      );
    });

    it("користуються власник і менеджер, решті відмовлено", async () => {
      for (const role of USER_ROLES) {
        const attempt = repeatLastOrder(t.db, t.users[role], t.client.id);
        if (role === "owner" || role === "manager")
          await expect(attempt, role).resolves.not.toBeUndefined();
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });
  });
});
