import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAddresses, orderItems } from "@/db/schema";
import { findForbiddenFields } from "@/server/dto";
import { ForbiddenError } from "@/server/guards";
import {
  getOrderPricing,
  listClientAddressOptions,
  searchClientsForOrder,
} from "@/server/order-form";
import { createOrder } from "@/server/orders";
import { USER_ROLES } from "@/server/permissions";
import { changeClientPrice } from "@/server/prices";
import { makeClient } from "../db/helpers";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("підказки для форми замовлення", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  describe("пошук клієнта", () => {
    it("за назвою, кодом і телефоном; менше двох символів нічого не шукає", async () => {
      const found = await makeClient(t.db, { name: "Піцерія Мілано", code: "АА901" });
      const { addContact } = await import("@/server/client-details");
      await addContact(t.db, t.users.manager, found.id, { name: "Олена", phone: "050 777 88 99" });
      for (const query of ["Мілано", "АА901", "aa901", "777 88"]) {
        const result = await searchClientsForOrder(t.db, t.users.manager, query);
        expect(
          result.map((c) => c.id),
          query,
        ).toContain(found.id);
      }
      expect(await searchClientsForOrder(t.db, t.users.manager, "М")).toEqual([]);
      expect(await searchClientsForOrder(t.db, t.users.manager, "   ")).toEqual([]);
    });

    it("не більше восьми, без цін; видалені не показуються", async () => {
      for (let i = 0; i < 10; i++) await makeClient(t.db, { name: `Масовка ${i}` });
      await makeClient(t.db, { name: "Масовка видалена", deletedAt: new Date() });
      const result = await searchClientsForOrder(t.db, t.users.owner, "Масовка");
      expect(result).toHaveLength(8);
      expect(result.every((c) => !c.name.includes("видалена"))).toBe(true);
      expect(findForbiddenFields(result, "manager")).toEqual([]);
    });

    it("користуються власник і менеджер, решті відмовлено", async () => {
      for (const role of USER_ROLES) {
        const attempt = searchClientsForOrder(t.db, t.users[role], "Кафе");
        if (role === "owner" || role === "manager")
          await expect(attempt, role).resolves.toBeInstanceOf(Array);
        else await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    });
  });

  describe("адреси клієнта", () => {
    it("вид і текст одним рядком, за замовчуванням першою", async () => {
      const client = await makeClient(t.db, { name: "З адресами" });
      await t.db.insert(clientAddresses).values([
        { clientId: client.id, kind: "np_warehouse", cityText: "Львів", npWarehouseNumber: "14" },
        {
          clientId: client.id,
          kind: "delivery",
          label: "Офіс",
          cityText: "Київ",
          addressText: "вул. Тестова, 1",
          isDefault: true,
        },
      ]);
      const options = await listClientAddressOptions(t.db, t.users.manager, client.id);
      expect(options.map((o) => o.text)).toEqual([
        "Доставка: Офіс, Київ, вул. Тестова, 1",
        "Склад Нової Пошти: Львів, відділення № 14",
      ]);
      expect(options[0]?.isDefault).toBe(true);
    });

    it("клієнт без адрес: порожній список; некоректний id відхиляється; ролі", async () => {
      const bare = await makeClient(t.db, { name: "Без адрес" });
      expect(await listClientAddressOptions(t.db, t.users.manager, bare.id)).toEqual([]);
      await expect(listClientAddressOptions(t.db, t.users.manager, "ні")).rejects.toThrow(
        "Некоректний ідентифікатор.",
      );
      await expect(listClientAddressOptions(t.db, t.users.accountant, bare.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("ціна й надбавка для форми (D52, D53)", () => {
    const pricing = (
      overrides: Partial<Parameters<typeof getOrderPricing>[2]> = {},
      actor = t.users.manager,
    ) =>
      getOrderPricing(t.db, actor, {
        clientId: t.client.id,
        iceTypeId: t.ice16,
        orderDate: ORDER_DATE,
        deliveryMethod: "pickup",
        ...overrides,
      });

    it("прайс, коли в клієнта своєї ціни немає", async () => {
      expect(await pricing()).toMatchObject({
        source: "default",
        pricePerKg: "75.00",
        markupPercent: 0,
      });
    });

    it("ціна клієнта сильніша, її джерело видно", async () => {
      const vip = await makeClient(t.db, { name: "Опт форма" });
      await changeClientPrice(t.db, t.users.manager, {
        clientId: vip.id,
        iceTypeId: t.ice16,
        pricePerKg: "60",
        validFrom: "2026-01-01",
      });
      expect(await pricing({ clientId: vip.id })).toMatchObject({
        source: "client",
        pricePerKg: "60.00",
      });
      await changeClientPrice(t.db, t.users.manager, {
        clientId: vip.id,
        iceTypeId: null,
        pricePerKg: "55",
        validFrom: "2026-01-01",
      });
      expect(await pricing({ clientId: vip.id, iceTypeId: t.ice3 })).toMatchObject({
        source: "client_any_type",
        pricePerKg: "55.00",
      });
    });

    it("ціни немає: джерело «none»; без типу льоду теж", async () => {
      expect(await pricing({ iceTypeId: t.ice3 })).toMatchObject({
        source: "none",
        pricePerKg: null,
      });
      expect(await pricing({ iceTypeId: null })).toMatchObject({
        source: "none",
        pricePerKg: null,
      });
    });

    it("надбавка: Нова Пошта 10%, застосування «Важкий дим» 10%, окрема надбавка клієнта", async () => {
      expect((await pricing({ deliveryMethod: "np" })).markupPercent).toBe(10);
      const smoke = await makeClient(t.db, {
        name: "Дим форма",
        applicationId: await t.applicationId("heavy_smoke"),
      });
      expect((await pricing({ clientId: smoke.id })).markupPercent).toBe(10);
      const own = await makeClient(t.db, { name: "Окрема форма", markupPercentOverride: "5.00" });
      expect((await pricing({ clientId: own.id, deliveryMethod: "np" })).markupPercent).toBe(5);
    });

    it("відповідь збігається з тим, що збереже createOrder", async () => {
      const hint = await pricing({ deliveryMethod: "np" });
      const { id } = await t.create({ deliveryMethod: "np" });
      const item = (await t.db.select().from(orderItems).where(eq(orderItems.orderId, id)))[0];
      expect(item?.price).toBe(hint.pricePerKg);
    });

    it("некоректні дані відхиляються, ролі без права відмовлено, грошей у відповіді немає зайвих", async () => {
      await expect(pricing({ orderDate: "вчора" })).rejects.toThrow("Вкажіть дату");
      await expect(pricing({ clientId: "ні" })).rejects.toThrow("Некоректний ідентифікатор.");
      await expect(pricing({}, t.users.location_lead)).rejects.toThrow(ForbiddenError);
      await expect(pricing({}, t.users.accountant)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("позиції при створенні замовлення", () => {
    it("додаткові позиції створюються разом із замовленням, сума збігається", async () => {
      const { id } = await t.create({
        items: [
          { kind: "delivery", title: "Доставка", qty: 1, price: 150 },
          { kind: "box_sale", title: "Бокс 46 л", qty: 2, unit: "шт", price: "500,50" },
        ],
      });
      const items = await t.db.select().from(orderItems).where(eq(orderItems.orderId, id));
      expect(items.map((i) => i.kind).sort()).toEqual(["box_sale", "delivery", "ice"]);
      const { getOrder } = await import("@/server/orders");
      expect((await getOrder(t.db, t.users.manager, id))?.total).toBe("3401.00");
    });

    it("позиції без ціни (з шаблону «як минулого разу») створюються з нульовою ціною", async () => {
      const { id } = await t.create({ items: [{ kind: "other", title: "Лід для фото", qty: 3 }] });
      const item = (await t.db.select().from(orderItems).where(eq(orderItems.orderId, id))).find(
        (i) => i.kind === "other",
      );
      expect(item).toMatchObject({ price: "0.00", unit: "шт", qty: "3.000" });
    });

    it("погана позиція скасовує всю створення: чернетка не з'являється", async () => {
      const before = (await t.db.select().from(orderItems)).length;
      await expect(
        t.create({ items: [{ kind: "delivery", title: " ", qty: 1, price: 1 }] }),
      ).rejects.toThrow("Вкажіть назву позиції.");
      await expect(
        t.create({ items: [{ kind: "ice" as never, title: "Лід", qty: 1, price: 1 }] }),
      ).rejects.toThrow("Оберіть вид позиції");
      expect((await t.db.select().from(orderItems)).length).toBe(before);
    });

    it("не більше двадцяти додаткових позицій", async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        kind: "other" as const,
        title: `П${i}`,
        qty: 1,
        price: 1,
      }));
      await expect(
        createOrder(t.db, t.users.manager, {
          clientId: t.client.id,
          locationId: t.location,
          orderDate: ORDER_DATE,
          items,
        }),
      ).rejects.toThrow("Забагато додаткових позицій.");
    });
  });
});
