import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/guards";
import { USER_ROLES } from "@/server/permissions";
import { createProduct, listProducts, updateProduct } from "@/server/products";
import { listOrderProducts } from "@/server/order-products";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("довідник товарів (D174)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("початкові товари: лід, бокси, рідкий азот з обмеженням доставки", async () => {
    const list = await listProducts(t.db, owner());
    expect(list.map((p) => [p.code, p.kind, p.unit])).toEqual([
      ["ice", "ice", "кг"],
      ["box", "box", "шт"],
      ["nitrogen", "other", "кг"],
    ]);
    expect(list.find((p) => p.code === "nitrogen")).toMatchObject({
      producedByWorkshop: true,
      allowedDeliveryMethods: ["pickup", "our_delivery"],
    });
  });

  it("новий товар: з'являється в замовленні, без обмежень, якщо вибрано всі способи доставки", async () => {
    const created = await createProduct(t.db, owner(), {
      name: "Сухий пар",
      unit: "шт",
      producedByWorkshop: false,
      deliveryMethods: ["pickup", "our_delivery", "np"],
    });
    expect(created.code).toMatch(/^product_/);
    const option = (await listOrderProducts(t.db)).find((p) => p.code === created.code);
    expect(option).toMatchObject({ name: "Сухий пар", unit: "шт", allowedDeliveryMethods: null });
    // Неактивний товар у замовленні не пропонується, назва й доставка змінюються.
    await updateProduct(t.db, owner(), created.id, {
      name: "Сухий пар 2",
      producedByWorkshop: true,
      deliveryMethods: ["pickup"],
      isActive: false,
    });
    expect((await listOrderProducts(t.db)).some((p) => p.code === created.code)).toBe(false);
    const view = (await listProducts(t.db, owner())).find((p) => p.id === created.id)!;
    expect(view).toMatchObject({
      name: "Сухий пар 2",
      producedByWorkshop: true,
      allowedDeliveryMethods: ["pickup"],
      isActive: false,
    });
  });

  it("лід і бокси тут не змінюємо; помилки введення; права", async () => {
    const list = await listProducts(t.db, owner());
    const ice = list.find((p) => p.code === "ice")!;
    await expect(
      updateProduct(t.db, owner(), ice.id, {
        name: "Лід",
        producedByWorkshop: true,
        deliveryMethods: ["pickup"],
        isActive: true,
      }),
    ).rejects.toThrow("власні довідники");
    await expect(
      createProduct(t.db, owner(), {
        name: " ",
        unit: "кг",
        producedByWorkshop: true,
        deliveryMethods: ["pickup"],
      }),
    ).rejects.toThrow("назву товару");
    await expect(
      createProduct(t.db, owner(), {
        name: "Х",
        unit: "кг",
        producedByWorkshop: true,
        deliveryMethods: [],
      }),
    ).rejects.toThrow("хоча б один спосіб");
    for (const role of USER_ROLES.filter((r) => r !== "owner")) {
      await expect(
        createProduct(t.db, t.users[role], {
          name: "Х",
          unit: "кг",
          producedByWorkshop: true,
          deliveryMethods: ["pickup"],
        }),
      ).rejects.toThrow(ForbiddenError);
    }
  });
});
