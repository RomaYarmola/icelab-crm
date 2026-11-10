import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderItems, orders } from "@/db/schema";
import { findForbiddenFields, forbiddenKeysFor, toOrderItemView, toOrderView } from "@/server/dto";
import { USER_ROLES, type UserRole } from "@/server/permissions";
import { createTestDb, type TestDb } from "../db/harness";
import { makeClient, makeLocation, makeOrder } from "../db/helpers";

describe("безпечне подання даних", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let order: Awaited<ReturnType<typeof makeOrder>>;
  let item: typeof orderItems.$inferSelect;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    const location = await makeLocation(db);
    const client = await makeClient(db);
    order = await makeOrder(db, {
      clientId: client.id,
      locationId: location.id,
      kgSold: "40",
      kgToProduce: "44",
      pricePerKgSnapshot: "75.00",
      paymentKind: "cash",
      internalComment: "внутрішня примітка",
      telegramChatId: 123,
    });
    const [insertedItem] = await db
      .insert(orderItems)
      .values({ orderId: order.id, kind: "ice", title: "Лід 16 мм", qty: "40", price: "75.00" })
      .returning();
    item = insertedItem!;
    // Тригер перерахував суму замовлення: читаємо актуальний рядок.
    const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id));
    order = fresh!;
    expect(order.total).toBe("3000.00");
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const moneyFields = ["pricePerKgSnapshot", "total"];
  const paymentFields = ["paymentKind", "paidAt"];

  it("виробництво не отримує ні грошей, ні оплати, але має все потрібне для роботи", () => {
    const view = toOrderView(order, "production");
    for (const field of [...moneyFields, ...paymentFields])
      expect(view, field).not.toHaveProperty(field);
    // Кілограми в базі мають три знаки після коми (numeric(10,3)).
    expect(view).toMatchObject({
      id: order.id,
      kgToProduce: "44.000",
      kgSold: "40.000",
      status: "draft",
    });
    expect(findForbiddenFields(view, "production")).toEqual([]);
  });

  it("старший локації не бачить цін і сум, але бачить спосіб оплати (веде готівку)", () => {
    const view = toOrderView(order, "location_lead");
    for (const field of moneyFields) expect(view, field).not.toHaveProperty(field);
    expect(view).toMatchObject({ paymentKind: "cash" });
    expect(findForbiddenFields(view, "location_lead")).toEqual([]);
  });

  it("власник, менеджер і бухгалтер бачать ціни, суми й оплату", () => {
    for (const role of ["owner", "manager", "accountant"] as const) {
      expect(toOrderView(order, role), role).toMatchObject({
        pricePerKgSnapshot: "75.00",
        total: "3000.00",
        paymentKind: "cash",
      });
    }
  });

  it("службові поля не потрапляють у подання жодної ролі", () => {
    for (const role of USER_ROLES) {
      const view = toOrderView(order, role);
      expect(view, role).not.toHaveProperty("internalComment");
      expect(view, role).not.toHaveProperty("telegramChatId");
      expect(view, role).not.toHaveProperty("draftPayload");
    }
  });

  it("позиція замовлення: ціна й сума лише для ролей з правом на суми", () => {
    const production = toOrderItemView(item, "production");
    expect(production).not.toHaveProperty("price");
    expect(production).not.toHaveProperty("amount");
    expect(production).toMatchObject({ title: "Лід 16 мм", qty: "40.000" });
    expect(toOrderItemView(item, "manager")).toMatchObject({ price: "75.00", amount: "3000.00" });
    expect(findForbiddenFields(production, "production")).toEqual([]);
  });

  describe("перевірка готової відповіді", () => {
    it("«сирий» рядок замовлення для виробництва містить заборонені поля, і перевірка їх знаходить", () => {
      expect(findForbiddenFields(order, "production").sort()).toEqual(
        ["paidAt", "paymentKind", "pricePerKgSnapshot", "total"].sort(),
      );
    });

    it("знаходить поля на будь-якій вкладеності й в обох написаннях (camelCase і snake_case)", () => {
      const response = {
        data: {
          orders: [{ id: 1, items: [{ title: "Лід", price_per_kg: "75" }], cash_amount: "100" }],
          payments: [],
        },
      };
      expect(findForbiddenFields(response, "production").sort()).toEqual(
        [
          "data.orders[0].cash_amount",
          "data.orders[0].items[0].price_per_kg",
          "data.payments",
        ].sort(),
      );
    });

    it("не вважає помилкою поля, дозволені ролі, і не чіпає значення", () => {
      const response = { total: "100", price: "10", payments: [], cashAmount: "5" };
      expect(findForbiddenFields(response, "owner")).toEqual([]);
      // Слово «price» у тексті, а не в назві поля, не є проблемою.
      expect(findForbiddenFields({ title: "price total amount" }, "production")).toEqual([]);
    });

    it("менеджер не бачить безготівки, бухгалтер бачить", () => {
      expect(findForbiddenFields({ payments: [] }, "manager")).toEqual(["payments"]);
      expect(findForbiddenFields({ payments: [] }, "accountant")).toEqual([]);
    });

    it("водій не бачить жодних грошових полів", () => {
      expect(
        findForbiddenFields({ total: 1, cashAmount: 1, payments: [] }, "driver").sort(),
      ).toEqual(["cashAmount", "payments", "total"].sort());
    });

    it("для кожної ролі набір заборонених полів відповідає матриці", () => {
      const expectations: Record<UserRole, { price: boolean; cash: boolean; bank: boolean }> = {
        owner: { price: false, cash: false, bank: false },
        manager: { price: false, cash: false, bank: true },
        location_lead: { price: true, cash: false, bank: true },
        production: { price: true, cash: true, bank: true },
        accountant: { price: false, cash: false, bank: false },
        driver: { price: true, cash: true, bank: true },
      };
      for (const role of USER_ROLES) {
        const forbidden = forbiddenKeysFor(role);
        expect(forbidden.has("total"), `${role}: total`).toBe(expectations[role].price);
        expect(forbidden.has("cashamount"), `${role}: cashAmount`).toBe(expectations[role].cash);
        expect(forbidden.has("payments"), `${role}: payments`).toBe(expectations[role].bank);
      }
    });
  });
});
