import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxTypes, orderItems, orders, productPrices } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { updateOrder } from "@/server/orders";
import {
  changeBoxPrice,
  currentBoxPrices,
  listBoxPrices,
  resolveBoxPrice,
} from "@/server/product-prices";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("продаж боксів і ціни товарів (D174, D175)", () => {
  let t: OrderTestContext;
  let mini: string;
  let small: string;
  let long: string;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
    const byCode = async (code: string) =>
      (await t.db.select().from(boxTypes).where(eq(boxTypes.code, code)))[0]!.id;
    mini = await byCode("mini_9");
    small = await byCode("ours_small_19");
    long = await byCode("ours_long_46");
    await changeBoxPrice(t.db, owner(), {
      boxTypeId: mini,
      pricePerUnit: 500,
      validFrom: "2026-01-01",
    });
    await changeBoxPrice(t.db, owner(), {
      boxTypeId: small,
      pricePerUnit: 500,
      validFrom: "2026-01-01",
    });
    await changeBoxPrice(t.db, owner(), {
      boxTypeId: long,
      pricePerUnit: 650,
      validFrom: "2026-01-01",
    });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const items = (orderId: string) =>
    t.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

  it("ціна боксів з історією «нова ціна від дати»: стара закривається, майбутня ще не діє", async () => {
    expect(await resolveBoxPrice(t.db, long, "2026-11-13")).toBe("650.00");
    await changeBoxPrice(t.db, owner(), {
      boxTypeId: long,
      pricePerUnit: "700",
      validFrom: "2026-12-01",
    });
    expect(await resolveBoxPrice(t.db, long, "2026-11-30")).toBe("650.00");
    expect(await resolveBoxPrice(t.db, long, "2026-12-01")).toBe("700.00");
    const history = (await listBoxPrices(t.db, owner())).filter((p) => p.boxTypeId === long);
    expect(history.map((p) => [p.pricePerUnit, p.validTo])).toEqual([
      ["700.00", null],
      ["650.00", "2026-11-30"],
    ]);
    expect((await currentBoxPrices(t.db, "2026-11-13"))[long]).toBe("650.00");
    // Повернути 650 для наступних тестів.
    await t.db.delete(productPrices).where(eq(productPrices.pricePerUnit, "700.00"));
    await t.db
      .update(productPrices)
      .set({ validTo: null })
      .where(eq(productPrices.pricePerUnit, "650.00"));
  });

  it("змінювати ціну може лише власник; бокси клієнта й невідомі типи не продаємо", async () => {
    for (const role of USER_ROLES.filter((r) => r !== "owner")) {
      await expect(
        changeBoxPrice(t.db, t.users[role], {
          boxTypeId: mini,
          pricePerUnit: 1,
          validFrom: "2026-11-13",
        }),
      ).rejects.toThrow(ForbiddenError);
    }
    const clientBox = (
      await t.db.select().from(boxTypes).where(eq(boxTypes.code, "client_box"))
    )[0]!;
    await expect(
      changeBoxPrice(t.db, owner(), {
        boxTypeId: clientBox.id,
        pricePerUnit: 1,
        validFrom: "2026-11-13",
      }),
    ).rejects.toThrow("не продаємо");
    await expect(
      t.create({ kgSold: 0, boxSales: [{ boxTypeId: clientBox.id, qty: 1 }] }),
    ).rejects.toThrow("не продаємо");
  });

  it("замовлення лише з боксами: позиції з цінами з прайсу, сума, підтвердження без льоду", async () => {
    const order = await t.create({
      iceTypeId: null,
      kgSold: 0,
      boxSales: [
        { boxTypeId: mini, qty: 2 },
        { boxTypeId: long, qty: 1 },
      ],
    });
    const box = (await items(order.id)).filter((i) => i.kind === "box_sale");
    expect(box.map((i) => [i.title, i.qty, i.unit, i.price]).sort()).toEqual([
      ["Бокс Довгий 46 л", "1.000", "шт", "650.00"],
      ["Бокс Міні 9 л", "2.000", "шт", "500.00"],
    ]);
    expect(box.every((i) => i.productId !== null)).toBe(true);
    expect((await row(order.id)).total).toBe("1650.00");

    await transitionOrder(t.db, owner(), order.id, "confirmed");
    expect(await row(order.id)).toMatchObject({ status: "confirmed", pricePerKgSnapshot: "0.00" });
  });

  it("лід без боксів і без льоду все ще не підтверджується", async () => {
    const empty = await t.create({ iceTypeId: null, kgSold: 0 });
    await expect(transitionOrder(t.db, owner(), empty.id, "confirmed")).rejects.toThrow(
      "тип льоду",
    );
  });

  it("лід разом із боксами; ціну можна вказати вручну; зміна замінює позиції", async () => {
    const order = await t.create({
      boxSales: [{ boxTypeId: small, qty: 3, price: "450" }],
    });
    expect(await row(order.id)).toMatchObject({ total: "3600.00" });
    await updateOrder(t.db, t.users.manager, order.id, {
      boxSales: [{ boxTypeId: small, qty: 1 }],
    });
    const left = (await items(order.id)).filter((i) => i.kind === "box_sale");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ qty: "1.000", price: "500.00" });
    expect((await row(order.id)).total).toBe("2750.00");
    await updateOrder(t.db, t.users.manager, order.id, { boxSales: [] });
    expect((await items(order.id)).filter((i) => i.kind === "box_sale")).toHaveLength(0);
  });

  it("помилки: нуль і дробова кількість, ціна не число", async () => {
    await expect(t.create({ boxSales: [{ boxTypeId: mini, qty: 0 }] })).rejects.toThrow();
    await expect(t.create({ boxSales: [{ boxTypeId: mini, qty: 1.5 }] })).rejects.toThrow();
    await expect(
      t.create({ boxSales: [{ boxTypeId: mini, qty: 1, price: "багато" }] }),
    ).rejects.toThrow("ціну числом");
  });
});
