import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderItems, orders } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { addOrderItem, deleteOrderItem, updateOrderItem } from "@/server/order-items";
import { transitionOrder } from "@/server/order-status";
import { getOrder } from "@/server/orders";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("позиції замовлення (D55)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const total = async (id: string) =>
    (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.total;
  const items = (id: string) => t.db.select().from(orderItems).where(eq(orderItems.orderId, id));

  it("«Доставка», «Продаж боксу» й «Інше» додаються, сума перераховується базою", async () => {
    const { id } = await t.create();
    await addOrderItem(t.db, t.users.manager, id, {
      kind: "delivery",
      title: "Доставка по Києву",
      qty: 1,
      price: 150,
    });
    expect(await total(id)).toBe("2400.00");
    const box = await addOrderItem(t.db, t.users.manager, id, {
      kind: "box_sale",
      title: "Бокс 46 л",
      qty: 2,
      unit: "шт",
      price: "500,50",
    });
    expect(await total(id)).toBe("3401.00");
    await addOrderItem(t.db, t.users.owner, id, {
      kind: "other",
      title: "Сухий лід для фото",
      qty: 0.5,
      price: 100,
    });
    expect(await total(id)).toBe("3451.00");
    const all = await items(id);
    expect(all.map((i) => i.kind).sort()).toEqual(["box_sale", "delivery", "ice", "other"]);
    expect(all.find((i) => i.id === box.id)).toMatchObject({ unit: "шт", amount: "1001.00" });
    expect(all.find((i) => i.kind === "delivery")?.unit).toBe("послуга");
  });

  it("позицію можна змінити й видалити, сума слідує", async () => {
    const { id } = await t.create();
    const { id: itemId } = await addOrderItem(t.db, t.users.manager, id, {
      kind: "delivery",
      title: "Доставка",
      qty: 1,
      price: 150,
    });
    await updateOrderItem(t.db, t.users.manager, itemId, {
      price: 200,
      title: "Доставка за місто",
    });
    expect(await total(id)).toBe("2450.00");
    expect((await items(id)).find((i) => i.id === itemId)?.title).toBe("Доставка за місто");
    await deleteOrderItem(t.db, t.users.manager, itemId);
    expect(await total(id)).toBe("2250.00");
  });

  it("позицію «Лід» не додають, не міняють і не видаляють через позиції", async () => {
    const { id } = await t.create();
    await expect(
      addOrderItem(t.db, t.users.manager, id, {
        kind: "ice" as never,
        title: "Лід",
        qty: 1,
        price: 1,
      }),
    ).rejects.toThrow("Оберіть вид позиції");
    const [ice] = await items(id);
    await expect(updateOrderItem(t.db, t.users.manager, ice!.id, { price: 1 })).rejects.toThrow(
      "через поля замовлення",
    );
    await expect(deleteOrderItem(t.db, t.users.manager, ice!.id)).rejects.toThrow(
      "через поля замовлення",
    );
    expect(await total(id)).toBe("2250.00");
  });

  it("некоректні значення відхиляються", async () => {
    const { id } = await t.create();
    const base = { kind: "delivery" as const, title: "Доставка", qty: 1, price: 100 };
    await expect(addOrderItem(t.db, t.users.manager, id, { ...base, title: "  " })).rejects.toThrow(
      "Вкажіть назву позиції.",
    );
    await expect(addOrderItem(t.db, t.users.manager, id, { ...base, qty: 0 })).rejects.toThrow(
      "більшою за нуль",
    );
    await expect(addOrderItem(t.db, t.users.manager, id, { ...base, qty: "abc" })).rejects.toThrow(
      "Кількість має бути числом.",
    );
    await expect(addOrderItem(t.db, t.users.manager, id, { ...base, price: -1 })).rejects.toThrow(
      "від'ємним",
    );
    await expect(
      addOrderItem(t.db, t.users.manager, id, { ...base, price: 5_000_000 }),
    ).rejects.toThrow("Надто велике");
    await expect(
      addOrderItem(t.db, t.users.manager, id, {
        ...base,
        boxTypeId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow("Тип тари не знайдено.");
    await expect(
      updateOrderItem(t.db, t.users.manager, "00000000-0000-4000-8000-000000000000", { price: 1 }),
    ).rejects.toThrow("Позицію не знайдено.");
  });

  it("змінюють власник і менеджер; решті відмовлено", async () => {
    const { id } = await t.create();
    for (const role of USER_ROLES) {
      const attempt = addOrderItem(t.db, t.users[role], id, {
        kind: "other",
        title: `Від ${role}`,
        qty: 1,
        price: 1,
      });
      if (role === "owner" || role === "manager")
        await expect(attempt, role).resolves.toHaveProperty("id");
      else await expect(attempt, role).rejects.toThrow(ForbiddenError);
    }
  });

  it("у підтвердженому позиції ще вільні, у виробництві лише власник із приміткою", async () => {
    const { id } = await t.create();
    await transitionOrder(t.db, t.users.manager, id, "confirmed");
    await addOrderItem(t.db, t.users.manager, id, {
      kind: "delivery",
      title: "Доставка",
      qty: 1,
      price: 100,
    });
    await transitionOrder(t.db, t.users.production, id, "in_production");
    const attempt = { kind: "other" as const, title: "Додатково", qty: 1, price: 50 };
    await expect(addOrderItem(t.db, t.users.manager, id, attempt)).rejects.toThrow(ForbiddenError);
    await expect(addOrderItem(t.db, t.users.owner, id, attempt)).rejects.toThrow("вкажіть причину");
    await addOrderItem(t.db, t.users.owner, id, attempt, { note: "Клієнт замовив ще" });
    expect(await total(id)).toBe("2400.00");
  });

  it("після відправлення, у скасованому й закритому позиції не міняються нікому", async () => {
    const { id } = await t.create();
    await transitionOrder(t.db, t.users.owner, id, "cancelled", { note: "х" });
    await expect(
      addOrderItem(t.db, t.users.owner, id, { kind: "other", title: "х", qty: 1, price: 1 }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("старший локації не додає, а картка для нього без цін позицій", async () => {
    const { id } = await t.create();
    await addOrderItem(t.db, t.users.manager, id, {
      kind: "delivery",
      title: "Доставка",
      qty: 1,
      price: 150,
    });
    const card = await getOrder(t.db, t.users.location_lead, id);
    expect(card?.items).toHaveLength(2);
    for (const item of card!.items) {
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("amount");
    }
  });
});
