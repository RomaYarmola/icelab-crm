import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxTypes, clientOwnBoxes, orderItems, orders } from "@/db/schema";
import { transitionOrder } from "@/server/order-status";
import { updateOrder } from "@/server/orders";
import { changeBoxPrice, changeProductPrice, resolveProductPrice } from "@/server/product-prices";
import { ForbiddenError } from "@/server/guards";
import { USER_ROLES } from "@/server/permissions";
import { makeClient } from "../db/helpers";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("рідкий азот і сосуди Дюара (D176, Роман 23.11.2026)", () => {
  let t: OrderTestContext;
  let dewar: string;
  let mini: string;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
    const byCode = async (code: string) =>
      (await t.db.select().from(boxTypes).where(eq(boxTypes.code, code)))[0]!.id;
    dewar = await byCode("dewar");
    mini = await byCode("mini_9");
    await changeProductPrice(t.db, owner(), {
      productCode: "nitrogen",
      pricePerUnit: 90,
      validFrom: "2026-01-01",
    });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const items = (orderId: string) =>
    t.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

  it("ціна азоту з історією; міняє лише власник", async () => {
    expect(await resolveProductPrice(t.db, "nitrogen", "2026-11-13")).toBe("90.00");
    await changeProductPrice(t.db, owner(), {
      productCode: "nitrogen",
      pricePerUnit: "95",
      validFrom: "2026-12-01",
    });
    expect(await resolveProductPrice(t.db, "nitrogen", "2026-11-30")).toBe("90.00");
    expect(await resolveProductPrice(t.db, "nitrogen", "2026-12-01")).toBe("95.00");
    for (const role of USER_ROLES.filter((r) => r !== "owner")) {
      await expect(
        changeProductPrice(t.db, t.users[role], {
          productCode: "nitrogen",
          pricePerUnit: 1,
          validFrom: "2026-11-13",
        }),
      ).rejects.toThrow(ForbiddenError);
    }
    await expect(
      changeProductPrice(t.db, owner(), {
        productCode: "ice",
        pricePerUnit: 1,
        validFrom: "2026-11-13",
      }),
    ).rejects.toThrow("своїх блоках");
  });

  it("азот разом із льодом: позиція кг × ціна з прайсу, сума, самовивіз", async () => {
    const order = await t.create({
      deliveryMethod: "pickup",
      nitrogen: { qty: "10", price: null },
    });
    const nitro = (await items(order.id)).find((i) => i.productId && i.kind === "other")!;
    expect(nitro).toMatchObject({
      title: "Рідкий азот",
      qty: "10.000",
      unit: "кг",
      price: "90.00",
    });
    // 30 кг льоду по 75 + 10 кг азоту по 90.
    expect((await row(order.id)).total).toBe("3150.00");
  });

  it("азот поштою не відправляємо: створення й зміна способу доставки відхиляються", async () => {
    await expect(t.create({ deliveryMethod: "np", nitrogen: { qty: 5 } })).rejects.toThrow(
      "не відправляємо Новою Поштою",
    );
    const own = await t.create({ deliveryMethod: "our_delivery", nitrogen: { qty: 5 } });
    await expect(
      updateOrder(t.db, t.users.manager, own.id, { deliveryMethod: "np" }),
    ).rejects.toThrow("не відправляємо Новою Поштою");
    // Без азоту Нова Пошта знову можлива.
    await updateOrder(t.db, t.users.manager, own.id, { nitrogen: null });
    await updateOrder(t.db, t.users.manager, own.id, { deliveryMethod: "np" });
    expect((await row(own.id)).deliveryMethod).toBe("np");
  });

  it("лише азот без льоду підтверджується; ціну можна вказати вручну; зміна кількості", async () => {
    const order = await t.create({
      iceTypeId: null,
      kgSold: 0,
      deliveryMethod: "pickup",
      nitrogen: { qty: "4", price: "100" },
    });
    expect((await row(order.id)).total).toBe("400.00");
    await updateOrder(t.db, t.users.manager, order.id, { nitrogen: { qty: 6 } });
    const nitro = (await items(order.id)).filter((i) => i.productId && i.kind === "other");
    expect(nitro).toHaveLength(1);
    expect(nitro[0]).toMatchObject({ qty: "6.000", price: "90.00" });
    await transitionOrder(t.db, owner(), order.id, "confirmed");
    expect((await row(order.id)).status).toBe("confirmed");
  });

  it("помилки: нуль кг, не число", async () => {
    await expect(t.create({ nitrogen: { qty: 0 } })).rejects.toThrow("Вкажіть кількість");
    await expect(t.create({ nitrogen: { qty: "багато" } })).rejects.toThrow("Вкажіть кількість");
  });

  it("сосуд Дюара в тарі не впливає на місткість льоду, не продається", async () => {
    const plus = await makeClient(t.db, { name: "Азот і лід", markupPercentOverride: "10.00" });
    // 2 × Міні 9 л (7 кг) + сосуд: місткість лише від Міні, 14 кг; 14 + 10% = 15, обмежено 14.
    const order = await t.create({
      clientId: plus.id,
      kgSold: 14,
      boxes: [
        { boxTypeId: mini, count: 2 },
        { boxTypeId: dewar, count: 1 },
      ],
    });
    expect(await row(order.id)).toMatchObject({ boxCount: 3, kgToProduce: "14.000" });
    // Лише сосуд: місткість невідома, обмеження немає.
    const onlyDewar = await t.create({
      clientId: plus.id,
      kgSold: 14,
      boxes: [{ boxTypeId: dewar, count: 1 }],
    });
    expect((await row(onlyDewar.id)).kgToProduce).toBe("15.000");
    await expect(
      changeBoxPrice(t.db, owner(), { boxTypeId: dewar, pricePerUnit: 1, validFrom: "2026-11-13" }),
    ).rejects.toThrow("не продаємо");
    await expect(t.create({ boxSales: [{ boxTypeId: dewar, qty: 1 }] })).rejects.toThrow(
      "не продаємо",
    );
  });

  it("сосуд клієнта: бокс клієнта виду «dewar» теж не рахується в місткість льоду", async () => {
    const plus = await makeClient(t.db, { name: "Свій сосуд", markupPercentOverride: "10.00" });
    const [own] = await t.db
      .insert(clientOwnBoxes)
      .values({ clientId: plus.id, name: "Сосуд клієнта", kind: "dewar", capacityKg: "5" })
      .returning();
    const order = await t.create({
      clientId: plus.id,
      kgSold: 20,
      boxes: [{ clientOwnBoxId: own!.id, count: 1 }],
    });
    expect((await row(order.id)).kgToProduce).toBe("22.000");
  });
});
