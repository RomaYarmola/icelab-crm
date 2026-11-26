import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderItems, orders, profiles } from "@/db/schema";
import { listDriverOrders } from "@/server/driver";
import { parseDeliveryPrice } from "@/server/order-delivery";
import { transitionOrder } from "@/server/order-status";
import { updateOrder } from "@/server/orders";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("платна доставка в замовленні (D235)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const deliveryOf = async (id: string) =>
    (await t.db.select().from(orderItems).where(eq(orderItems.orderId, id))).filter(
      (item) => item.kind === "delivery",
    );

  it("розбирає суму: порожньо й нуль означають «немає», кома дозволена", () => {
    expect(parseDeliveryPrice(undefined)).toBeNull();
    expect(parseDeliveryPrice("  ")).toBeNull();
    expect(parseDeliveryPrice("0")).toBeNull();
    expect(parseDeliveryPrice("250,50")).toBe("250.50");
    expect(() => parseDeliveryPrice("-1")).toThrow("від'ємною");
    expect(() => parseDeliveryPrice("abc")).toThrow("числом");
    expect(() => parseDeliveryPrice(2_000_000)).toThrow("велика");
  });

  it("нове замовлення: окрема позиція, що входить у суму", async () => {
    const { id } = await t.create({ deliveryMethod: "our_delivery", deliveryPrice: "300" });
    expect(await row(id)).toMatchObject({ total: "2550.00" });
    expect(await deliveryOf(id)).toMatchObject([
      { title: "Доставка", qty: "1.000", unit: "послуга", price: "300.00" },
    ]);
  });

  it("Нова Пошта й самовивіз: суму доставки не приймає", async () => {
    for (const deliveryMethod of ["np", "pickup"] as const) {
      await expect(t.create({ deliveryMethod, deliveryPrice: 300 })).rejects.toThrow(
        "Платну доставку не вказуємо",
      );
    }
    const { id } = await t.create({ deliveryMethod: "np", deliveryPrice: "" });
    expect(await deliveryOf(id)).toEqual([]);
  });

  it("зміна: додає, міняє, не переписує без потреби й прибирає", async () => {
    const { id } = await t.create({ deliveryMethod: "our_delivery" });
    await updateOrder(t.db, t.users.manager, id, { deliveryPrice: "200" });
    const [added] = await deliveryOf(id);
    expect(await row(id)).toMatchObject({ total: "2450.00" });

    await updateOrder(t.db, t.users.manager, id, { deliveryPrice: 200 });
    expect((await deliveryOf(id))[0]!.id).toBe(added!.id);

    await updateOrder(t.db, t.users.manager, id, { deliveryPrice: "350" });
    expect(await row(id)).toMatchObject({ total: "2600.00" });
    expect(await deliveryOf(id)).toHaveLength(1);

    await updateOrder(t.db, t.users.manager, id, { comment: "без змін доставки" });
    expect(await deliveryOf(id)).toHaveLength(1);

    await updateOrder(t.db, t.users.manager, id, { deliveryPrice: null });
    expect(await deliveryOf(id)).toEqual([]);
    expect(await row(id)).toMatchObject({ total: "2250.00" });
  });

  it("перехід на Нову Пошту чи самовивіз сам знімає платну доставку", async () => {
    for (const deliveryMethod of ["np", "pickup"] as const) {
      const { id } = await t.create({ deliveryMethod: "our_delivery", deliveryPrice: 300 });
      await updateOrder(t.db, t.users.manager, id, { deliveryMethod });
      expect(await deliveryOf(id)).toEqual([]);
      expect(await row(id)).toMatchObject({ total: "2250.00" });
    }
  });

  it("водій бере готівкою суму разом із доставкою", async () => {
    await t.db
      .update(profiles)
      .set({ locationId: t.location })
      .where(eq(profiles.id, t.users.driver.id));
    const driver = { ...t.users.driver, locationId: t.location };
    const { id, number } = await t.create({
      deliveryMethod: "our_delivery",
      deliveryPrice: 300,
      paymentKind: "cash",
    });
    for (const status of ["confirmed", "in_production", "packed"] as const) {
      await transitionOrder(t.db, t.users.owner, id, status);
    }
    const list = await listDriverOrders(t.db, driver, ORDER_DATE);
    expect(list.find((order) => order.number === number)?.cashDue).toBe("2550.00");
  });
});
