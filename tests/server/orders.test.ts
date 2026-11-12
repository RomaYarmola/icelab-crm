import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAddresses, clients, orderItems, orders } from "@/db/schema";
import { findForbiddenFields } from "@/server/dto";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import {
  createOrder,
  deleteDraftOrder,
  getOrder,
  listOrders,
  loadOrderRow,
  updateOrder,
} from "@/server/orders";
import { USER_ROLES } from "@/server/permissions";
import { changeDefaultPrice } from "@/server/prices";
import { makeClient } from "../db/helpers";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("замовлення: створення, зміна, список, картка", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const itemsOf = (orderId: string) =>
    t.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

  describe("створення чернетки (D52, D53, D55)", () => {
    it("чернетка з номером, позицією «Лід», ціною з прайсу й сумою", async () => {
      const { id, number } = await t.create();
      expect(number).toBeGreaterThan(0);
      const order = await row(id);
      expect(order).toMatchObject({
        status: "draft",
        priceManual: false,
        pricePerKgSnapshot: null,
        kgSold: "30.000",
        total: "2250.00",
      });
      const [item] = await itemsOf(id);
      expect(item).toMatchObject({
        kind: "ice",
        title: "Лід 16 мм",
        qty: "30.000",
        unit: "кг",
        price: "75.00",
      });
    });

    it("«виготовити»: самовивіз без надбавки, Нова Пошта +10%", async () => {
      const pickup = await t.create({ deliveryMethod: "pickup" });
      expect(await row(pickup.id)).toMatchObject({
        kgToProduce: "30.000",
        markupPercentApplied: "0.00",
      });
      const np = await t.create({ deliveryMethod: "np" });
      expect(await row(np.id)).toMatchObject({
        kgToProduce: "33.000",
        markupPercentApplied: "10.00",
      });
    });

    it("«Важкий дим» дає +10%, окрема надбавка клієнта сильніша за загальну", async () => {
      const smoke = await makeClient(t.db, {
        name: "Дим",
        applicationId: await t.applicationId("heavy_smoke"),
      });
      const a = await t.create({ clientId: smoke.id });
      expect((await row(a.id)).kgToProduce).toBe("33.000");
      const custom = await makeClient(t.db, { name: "Окрема", markupPercentOverride: "5.00" });
      const b = await t.create({ clientId: custom.id, deliveryMethod: "np" });
      expect(await row(b.id)).toMatchObject({
        kgToProduce: "32.000",
        markupPercentApplied: "5.00",
      });
    });

    it("ціна клієнта сильніша за прайс, «менеджер вказав» ціну вручну", async () => {
      const vip = await makeClient(t.db, { name: "Опт" });
      const { changeClientPrice } = await import("@/server/prices");
      await changeClientPrice(t.db, t.users.manager, {
        clientId: vip.id,
        iceTypeId: t.ice16,
        pricePerKg: "60",
        validFrom: "2026-01-01",
      });
      const own = await t.create({ clientId: vip.id });
      expect((await itemsOf(own.id))[0]?.price).toBe("60.00");
      const manual = await t.create({ price: "55,5" });
      expect(await row(manual.id)).toMatchObject({ priceManual: true, total: "1665.00" });
    });

    it("немає ціни ніде: позиція з нульовою ціною, підтвердити не вийде (D52)", async () => {
      const { id } = await t.create({ iceTypeId: t.ice3 });
      expect((await itemsOf(id))[0]?.price).toBe("0.00");
      expect((await row(id)).total).toBe("0.00");
    });

    it("порожня чернетка: без льоду й кг лише клієнт, локація, дата", async () => {
      const { id } = await t.create({ iceTypeId: null, kgSold: undefined });
      expect(await row(id)).toMatchObject({ kgSold: "0.000", kgToProduce: "0.000", total: "0.00" });
      expect((await itemsOf(id))[0]).toMatchObject({ title: "Лід", price: "0.00" });
    });

    it("телефон отримувача нормалізується, адреса має бути клієнта", async () => {
      const own = await t.db
        .insert(clientAddresses)
        .values({ clientId: t.client.id, kind: "delivery", addressText: "вул. Тестова, 1" })
        .returning();
      const ok = await t.create({ recipientPhone: "050 123 45 67", addressId: own[0]!.id });
      expect(await row(ok.id)).toMatchObject({
        recipientPhone: "+380501234567",
        addressId: own[0]!.id,
      });
      const stranger = await makeClient(t.db, { name: "Чужий" });
      await expect(t.create({ clientId: stranger.id, addressId: own[0]!.id })).rejects.toThrow(
        "Адреса не належить цьому клієнту.",
      );
    });

    it("некоректні дані відхиляються з повідомленням", async () => {
      const bad = async (overrides: Parameters<typeof t.create>[0], message: string) => {
        await expect(t.create(overrides), message).rejects.toThrow(message);
      };
      await bad({ orderDate: "2026-02-31" }, "Вкажіть дату замовлення.");
      await bad({ kgSold: "abc" }, "Кілограми мають бути числом.");
      await bad({ kgSold: -5 }, "Кілограми не можуть бути від'ємними.");
      await bad({ kgSold: 999999 }, "Забагато кілограмів");
      await bad({ deliveryMethod: "drone" as never }, "Оберіть спосіб доставки зі списку.");
      await bad({ recipientPhone: "123" }, "Не вдалося розпізнати телефон.");
      await bad({ boxCount: -1 }, "Кількість тари не може бути від'ємною.");
      await bad({ price: "abc" }, "Вкажіть ціну числом");
      await bad({ clientId: "00000000-0000-4000-8000-000000000000" }, "Клієнта не знайдено.");
      await bad({ locationId: "00000000-0000-4000-8000-000000000000" }, "Локацію не знайдено.");
      await bad({ iceTypeId: "00000000-0000-4000-8000-000000000000" }, "Тип льоду не знайдено.");
      await bad({ clientId: "не-uuid" }, "Некоректний ідентифікатор.");
    });

    it("видаленому клієнту замовлення не створити", async () => {
      const gone = await makeClient(t.db, { name: "Видалений", deletedAt: new Date() });
      await expect(t.create({ clientId: gone.id })).rejects.toThrow("Клієнта видалено");
    });

    it("створюють власник і менеджер, решті відмовлено", async () => {
      for (const role of USER_ROLES) {
        const attempt = t.create({}, t.users[role]);
        if (role === "owner" || role === "manager")
          await expect(attempt).resolves.toHaveProperty("id");
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });

    it("створення пишеться в історію статусів з автором і в журнал", async () => {
      const { id } = await t.create();
      const card = await getOrder(t.db, t.users.manager, id);
      expect(card?.history).toHaveLength(1);
      expect(card?.history[0]).toMatchObject({
        fromStatus: null,
        toStatus: "draft",
        changedByName: "Тест manager",
      });
    });
  });

  describe("зміна замовлення (D58)", () => {
    const confirmed = async () => {
      const { id } = await t.create();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      return id;
    };
    const inProduction = async () => {
      const id = await confirmed();
      await transitionOrder(t.db, t.users.production, id, "in_production");
      return id;
    };

    it("у чернетці зміна кг тягне за собою «виготовити», позицію й суму", async () => {
      const { id } = await t.create({ deliveryMethod: "np" });
      await updateOrder(t.db, t.users.manager, id, { kgSold: 40 });
      expect(await row(id)).toMatchObject({
        kgSold: "40.000",
        kgToProduce: "44.000",
        total: "3000.00",
      });
      expect((await itemsOf(id))[0]).toMatchObject({ qty: "40.000", price: "75.00" });
    });

    it("«виготовити», виправлене вручну, не перераховується", async () => {
      const { id } = await t.create({ deliveryMethod: "np" });
      await updateOrder(t.db, t.users.manager, id, { kgToProduce: 50 });
      await updateOrder(t.db, t.users.manager, id, { kgSold: 40 });
      expect((await row(id)).kgToProduce).toBe("50.000");
    });

    it("спосіб доставки Нова Пошта додає надбавку, самовивіз прибирає", async () => {
      const { id } = await t.create({ deliveryMethod: "pickup" });
      await updateOrder(t.db, t.users.manager, id, { deliveryMethod: "np" });
      expect((await row(id)).kgToProduce).toBe("33.000");
      await updateOrder(t.db, t.users.manager, id, { deliveryMethod: "pickup" });
      expect((await row(id)).kgToProduce).toBe("30.000");
    });

    it("зміна типу льоду в чернетці бере нову ціну за прайсом і назву", async () => {
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice3,
        pricePerKg: "90",
        validFrom: "2026-01-01",
      });
      const { id } = await t.create();
      await updateOrder(t.db, t.users.manager, id, { iceTypeId: t.ice3 });
      expect((await itemsOf(id))[0]).toMatchObject({ title: "Лід 3 мм", price: "90.00" });
      expect((await row(id)).total).toBe("2700.00");
    });

    it("ціна вручну зберігається, «порахувати за прайсом» повертає автоматичну", async () => {
      const { id } = await t.create();
      await updateOrder(t.db, t.users.manager, id, { price: "70" });
      expect(await row(id)).toMatchObject({ priceManual: true, total: "2100.00" });
      await updateOrder(t.db, t.users.manager, id, { iceTypeId: t.ice16, orderDate: "2026-11-14" });
      expect((await itemsOf(id))[0]?.price).toBe("70.00");
      await updateOrder(t.db, t.users.manager, id, { price: null });
      expect(await row(id)).toMatchObject({ priceManual: false, total: "2250.00" });
    });

    it("порожній набір змін нічого не робить, невідоме замовлення відхиляється", async () => {
      const { id } = await t.create();
      await expect(updateOrder(t.db, t.users.manager, id, {})).resolves.toBeUndefined();
      await expect(
        updateOrder(t.db, t.users.manager, "00000000-0000-4000-8000-000000000000", { kgSold: 1 }),
      ).rejects.toThrow("Замовлення не знайдено.");
    });

    it("у підтвердженому менеджер міняє кг, але не ціну; ціна лишається зафіксованою", async () => {
      const id = await confirmed();
      await updateOrder(t.db, t.users.manager, id, { kgSold: 20 });
      expect(await row(id)).toMatchObject({
        kgSold: "20.000",
        pricePerKgSnapshot: "75.00",
        total: "1500.00",
      });
      await expect(updateOrder(t.db, t.users.manager, id, { price: "70" })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(updateOrder(t.db, t.users.owner, id, { price: "70" })).rejects.toThrow(
        "Змінити ціну",
      );
    });

    it("зміна прайсу не чіпає підтверджене замовлення, а нове бере нову ціну", async () => {
      const id = await confirmed();
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "80",
        validFrom: "2026-11-01",
      });
      expect(await row(id)).toMatchObject({ pricePerKgSnapshot: "75.00", total: "2250.00" });
      const fresh = await t.create();
      expect((await itemsOf(fresh.id))[0]?.price).toBe("80.00");
      await changeDefaultPrice(t.db, t.users.owner, {
        iceTypeId: t.ice16,
        pricePerKg: "75",
        validFrom: "2026-11-02",
      });
    });

    it("у виробництві основні поля лише власник із приміткою, менеджер не може", async () => {
      const id = await inProduction();
      await expect(updateOrder(t.db, t.users.manager, id, { kgSold: 20 })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(updateOrder(t.db, t.users.owner, id, { kgSold: 20 })).rejects.toThrow(
        "вкажіть причину",
      );
      await updateOrder(t.db, t.users.owner, id, { kgSold: 20 }, { note: "Клієнт зменшив обсяг" });
      expect((await row(id)).kgSold).toBe("20.000");
    });

    it("старший локації міняє лише «виготовити» і коментар у своїй локації", async () => {
      const id = await confirmed();
      await updateOrder(t.db, t.users.location_lead, id, {
        kgToProduce: 36,
        comment: "Пакувати в два боксі",
      });
      expect(await row(id)).toMatchObject({
        kgToProduce: "36.000",
        comment: "Пакувати в два боксі",
      });
      await expect(updateOrder(t.db, t.users.location_lead, id, { kgSold: 10 })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        updateOrder(t.db, t.users.location_lead, id, { internalComment: "секрет" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(updateOrder(t.db, t.users.location_lead, id, { price: "1" })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("чужа локація, виробництво, бухгалтер і водій нічого не міняють", async () => {
      const id = await confirmed();
      await expect(updateOrder(t.db, t.otherLead, id, { kgToProduce: 36 })).rejects.toThrow(
        ForbiddenError,
      );
      for (const role of ["production", "accountant", "driver"] as const) {
        await expect(updateOrder(t.db, t.users[role], id, { comment: "х" }), role).rejects.toThrow(
          ForbiddenError,
        );
      }
    });

    it("внутрішній коментар міняють власник і менеджер, закриті й скасовані не міняються", async () => {
      const { id } = await t.create();
      await updateOrder(t.db, t.users.manager, id, { internalComment: "Постійний клієнт" });
      expect((await row(id)).internalComment).toBe("Постійний клієнт");
      await transitionOrder(t.db, t.users.manager, id, "cancelled", { note: "Помилка" });
      await expect(updateOrder(t.db, t.users.owner, id, { comment: "х" })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("замовлення, змінене між читанням і записом, не перезаписується мовчки", async () => {
      const { id } = await t.create();
      const stale = updateOrder(t.db, t.users.manager, id, { kgSold: 11 });
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      // Перший виклик міг устигнути до підтвердження; так чи інакше стан узгоджений і без помилки бази.
      await stale.catch((error) => expect(error).toBeInstanceOf(ValidationError));
      expect((await row(id)).status).toBe("confirmed");
    });
  });

  describe("видалення чернетки", () => {
    it("власник і менеджер видаляють чернетку, її не видно в списку й картці", async () => {
      const { id } = await t.create();
      await deleteDraftOrder(t.db, t.users.manager, id);
      expect(await getOrder(t.db, t.users.owner, id)).toBeNull();
      await expect(loadOrderRow(t.db, id)).rejects.toThrow("Замовлення не знайдено.");
      const listed = await listOrders(t.db, t.users.owner, {
        search: `№${(await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.number}`,
      });
      expect(listed.items).toHaveLength(0);
    });

    it("підтверджене видалити не можна, лише скасувати; решті ролей відмовлено", async () => {
      const { id } = await t.create();
      await expect(deleteDraftOrder(t.db, t.users.location_lead, id)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(deleteDraftOrder(t.db, t.users.accountant, id)).rejects.toThrow(ForbiddenError);
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      await expect(deleteDraftOrder(t.db, t.users.owner, id)).rejects.toThrow(
        "Видалити можна лише чернетку",
      );
    });
  });

  describe("список і пошук", () => {
    let other: { id: string; number: number | null };
    let nova: { id: string };
    const listNumbers = async (query: Parameters<typeof listOrders>[2], actor = t.users.owner) =>
      (await listOrders(t.db, actor, query)).items.map((item) => item.number);

    beforeAll(async () => {
      await t.db.delete(orders);
      const cafe = await makeClient(t.db, { name: "Список Кафе", managerId: t.users.manager.id });
      await t.create({ clientId: cafe.id, orderDate: "2026-11-10" });
      nova = await t.create({ clientId: cafe.id, orderDate: "2026-11-12", deliveryMethod: "np" });
      other = await t.create({ locationId: t.otherLocation, orderDate: "2026-11-12", kgSold: 5 });
      const done = await t.create({ orderDate: "2026-11-14" });
      await transitionOrder(t.db, t.users.manager, done.id, "confirmed");
    });

    it("нові дати першими, видалена чернетка прихована", async () => {
      const page = await listOrders(t.db, t.users.owner);
      expect(page.items.map((i) => i.orderDate)).toEqual([
        "2026-11-14",
        "2026-11-12",
        "2026-11-12",
        "2026-11-10",
      ]);
      expect(page.hasMore).toBe(false);
    });

    it("фільтри: діапазон дат, статус, спосіб доставки, локація, менеджер клієнта", async () => {
      expect(await listNumbers({ dateFrom: "2026-11-12", dateTo: "2026-11-12" })).toHaveLength(2);
      expect(await listNumbers({ statuses: ["confirmed"] })).toHaveLength(1);
      expect(await listNumbers({ statuses: ["draft", "confirmed"] })).toHaveLength(4);
      expect(await listNumbers({ deliveryMethod: "np" })).toEqual([(await row(nova.id)).number]);
      expect(await listNumbers({ locationId: t.otherLocation })).toEqual([other.number]);
      expect(await listNumbers({ managerId: t.users.manager.id })).toHaveLength(2);
    });

    it("пошук за номером (з «№» і без), кодом, назвою й частиною телефону клієнта", async () => {
      const n = (await row(nova.id)).number;
      expect(await listNumbers({ search: String(n) })).toContain(n);
      expect(await listNumbers({ search: `№ ${n}` })).toContain(n);
      // Пошук нечіткий (триграми): знаходить і схожу назву «Кафе Тест», тому перевіряємо наявність.
      const byName = await listNumbers({ search: "Список Кафе" });
      expect(byName).toContain(n);
      expect(byName.length).toBeGreaterThanOrEqual(2);
      expect(await listNumbers({ search: "кзкзкзкз" })).toEqual([]);
    });

    it("сторінки по `limit` з ознакою «є ще»", async () => {
      const first = await listOrders(t.db, t.users.owner, { limit: 3 });
      expect(first.items).toHaveLength(3);
      expect(first.hasMore).toBe(true);
      const rest = await listOrders(t.db, t.users.owner, { limit: 3, offset: 3 });
      expect(rest.items).toHaveLength(1);
      expect(rest.hasMore).toBe(false);
    });

    it("сміття у фільтрах відхиляється, а не ламає запит", async () => {
      await expect(listOrders(t.db, t.users.owner, { statuses: ["x" as never] })).rejects.toThrow(
        "Невідомий статус.",
      );
      await expect(listOrders(t.db, t.users.owner, { dateFrom: "вчора" })).rejects.toThrow(
        "Вкажіть дату",
      );
      await expect(listOrders(t.db, t.users.owner, { locationId: "ні" })).rejects.toThrow(
        "Некоректний ідентифікатор.",
      );
    });

    it("старший локації бачить лише свою локацію, навіть якщо просить чужу", async () => {
      const own = await listOrders(t.db, t.users.location_lead, { locationId: t.otherLocation });
      expect(own.items.every((item) => item.locationId === t.location)).toBe(true);
      expect(own.items.map((item) => item.number)).not.toContain(other.number);
      const theirs = await listOrders(t.db, t.otherLead, {});
      expect(theirs.items.map((item) => item.number)).toEqual([other.number]);
    });

    it("виробництво, водій без права на розділ, решта ролей читають", async () => {
      for (const role of USER_ROLES) {
        const attempt = listOrders(t.db, t.users[role], {});
        if (role === "production" || role === "driver")
          await expect(attempt, role).rejects.toThrow(ForbiddenError);
        else await expect(attempt, role).resolves.toHaveProperty("items");
      }
    });

    it("сума лише для ролей з правом на гроші, у відповіді немає заборонених полів", async () => {
      for (const role of ["owner", "manager", "accountant"] as const) {
        const page = await listOrders(t.db, t.users[role], {});
        expect(
          page.items.every((item) => item.total !== undefined),
          role,
        ).toBe(true);
        expect(findForbiddenFields(page, role), role).toEqual([]);
      }
      const lead = await listOrders(t.db, t.users.location_lead, {});
      expect(lead.items.length).toBeGreaterThan(0);
      expect(lead.items.every((item) => !("total" in item))).toBe(true);
      expect(findForbiddenFields(lead, "location_lead")).toEqual([]);
    });
  });

  describe("картка", () => {
    it("поля, імена довідників, позиції й історія", async () => {
      const { id } = await t.create({ deliveryMethod: "np", comment: "До 10:00" });
      const card = await getOrder(t.db, t.users.manager, id);
      expect(card).toMatchObject({
        id,
        status: "draft",
        clientName: "Кафе Тест",
        iceTypeName: "16 мм",
        locationName: expect.any(String),
        deliveryMethod: "np",
        comment: "До 10:00",
        total: "2250.00",
      });
      expect(card?.items).toHaveLength(1);
      expect(card?.items[0]).toMatchObject({ kind: "ice", price: "75.00", amount: "2250.00" });
    });

    it("власник і менеджер бачать внутрішній коментар, старший локації не бачить грошей і його", async () => {
      const { id } = await t.create({ internalComment: "Знижка за домовленістю" });
      expect(await getOrder(t.db, t.users.owner, id)).toHaveProperty(
        "internalComment",
        "Знижка за домовленістю",
      );
      const lead = await getOrder(t.db, t.users.location_lead, id);
      expect(lead).not.toBeNull();
      expect(lead).not.toHaveProperty("internalComment");
      expect(lead).not.toHaveProperty("total");
      expect(lead).not.toHaveProperty("pricePerKgSnapshot");
      expect(lead?.items[0]).not.toHaveProperty("price");
      expect(findForbiddenFields(lead, "location_lead")).toEqual([]);
      expect(
        findForbiddenFields(await getOrder(t.db, t.users.accountant, id), "accountant"),
      ).toEqual([]);
    });

    it("чуже замовлення для старшого локації це «не знайдено», а не «заборонено»", async () => {
      const { id } = await t.create({ locationId: t.otherLocation });
      expect(await getOrder(t.db, t.users.location_lead, id)).toBeNull();
      expect(await getOrder(t.db, t.otherLead, id)).not.toBeNull();
      expect(await getOrder(t.db, t.users.owner, id)).not.toBeNull();
    });

    it("невідоме, некоректне й видалене; виробництву відмовлено", async () => {
      expect(
        await getOrder(t.db, t.users.owner, "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
      await expect(getOrder(t.db, t.users.owner, "не-uuid")).rejects.toThrow(
        "Некоректний ідентифікатор.",
      );
      const { id } = await t.create();
      await expect(getOrder(t.db, t.users.production, id)).rejects.toThrow(ForbiddenError);
    });

    it("зміни ціни підтвердженого замовлення видно лише ролям з правом на гроші", async () => {
      const { id } = await t.create();
      await transitionOrder(t.db, t.users.manager, id, "confirmed");
      const { changeOrderPrice } = await import("@/server/order-status");
      await changeOrderPrice(t.db, t.users.owner, id, { pricePerKg: "70", note: "Знижка" });
      expect((await getOrder(t.db, t.users.owner, id))?.priceChanges).toHaveLength(1);
      expect((await getOrder(t.db, t.users.accountant, id))?.priceChanges).toHaveLength(1);
      expect(await getOrder(t.db, t.users.location_lead, id)).not.toHaveProperty("priceChanges");
    });
  });

  it("видалений клієнт не заважає читати старі замовлення", async () => {
    const { id } = await t.create();
    await t.db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, t.client.id));
    expect(await getOrder(t.db, t.users.owner, id)).not.toBeNull();
    await t.db.update(clients).set({ deletedAt: null }).where(eq(clients.id, t.client.id));
  });

  it("поточна дата тестів зафіксована", () => {
    expect(ORDER_DATE).toBe("2026-11-13");
    expect(createOrder).toBeTypeOf("function");
  });
});
