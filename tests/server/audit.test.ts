import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listAuditActors,
  listAuditEntries,
  listEntityHistory,
  type AuditEntryView,
} from "@/server/audit";
import { recordCashEntry, reverseCashEntry } from "@/server/cash";
import { createClient } from "@/server/clients";
import { addAddress, addContact } from "@/server/client-details";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { addOrderItem, deleteOrderItem } from "@/server/order-items";
import { changeOrderPrice, transitionOrder } from "@/server/order-status";
import { updateOrder } from "@/server/orders";
import { USER_ROLES } from "@/server/permissions";
import { changeDefaultPrice } from "@/server/prices";
import { markOrdersSeen } from "@/server/production";
import { addDays, todayIso } from "@/utils/isoDate";
import { changeClientPrice } from "@/server/prices";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const ALLOWED_JOURNAL = ["owner", "accountant"];
const ALLOWED_HISTORY = ["owner", "manager", "accountant"];

describe("журнал змін: читання, фільтри, права (B8, D89–D91)", () => {
  let t: OrderTestContext;
  let orderId: string;
  let orderNumber: number;
  let otherOrderId: string;
  let cashOrderId: string;
  let clientId: string;
  let clientCode: string;
  let deletedItemTitle: string;

  beforeAll(async () => {
    t = await setupOrderTests();

    // Замовлення з правками: кг, статуси, позиції (одну видалено), зміна ціни.
    const created = await t.create({ orderDate: "2031-03-03", kgSold: 30 });
    orderId = created.id;
    orderNumber = created.number!;
    await updateOrder(t.db, t.users.manager, orderId, { kgSold: 35 });
    await transitionOrder(t.db, t.users.owner, orderId, "confirmed");
    const item = await addOrderItem(t.db, t.users.manager, orderId, {
      kind: "delivery",
      title: "Доставка по Києву",
      qty: 1,
      price: 150,
    });
    deletedItemTitle = "Доставка по Києву";
    await deleteOrderItem(t.db, t.users.manager, item.id);
    await changeOrderPrice(t.db, t.users.owner, orderId, { pricePerKg: "70", note: "Знижка" });
    await markOrdersSeen(t.db, t.users.production, { date: "2031-03-03" });

    otherOrderId = (await t.create({ orderDate: "2031-03-04" })).id;

    // Готівка: запис, сторно, автозакриття системою.
    cashOrderId = (await t.create({ orderDate: "2031-03-05", paymentKind: "cash" })).id;
    await transitionOrder(t.db, t.users.owner, cashOrderId, "confirmed");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "in_production");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "packed");
    await transitionOrder(t.db, t.users.location_lead, cashOrderId, "shipped");
    const wrong = await recordCashEntry(t.db, t.users.location_lead, {
      orderId: cashOrderId,
      amount: "100",
    });
    await reverseCashEntry(t.db, t.users.owner, wrong.entryId, "Помилка");
    await recordCashEntry(t.db, t.users.location_lead, { orderId: cashOrderId, amount: "2250" });

    // Клієнт з контактом, адресою й ціною; прайс.
    const client = await createClient(t.db, t.users.manager, {
      name: "Журнальний клієнт",
      regionPrefix: "АА",
    });
    clientId = client.id;
    clientCode = client.code;
    await addContact(t.db, t.users.manager, clientId, { name: "Марія", phone: "0501234567" });
    await addAddress(t.db, t.users.manager, clientId, {
      kind: "delivery",
      cityText: "Київ",
      addressText: "вул. Сагайдачного, 12",
    });
    await changeClientPrice(t.db, t.users.manager, {
      clientId,
      iceTypeId: t.ice16,
      pricePerKg: "60",
      validFrom: "2031-01-01",
    });
    await changeDefaultPrice(t.db, t.users.owner, {
      iceTypeId: t.ice3,
      pricePerKg: "90",
      validFrom: "2031-01-01",
    });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const summaries = (items: AuditEntryView[]) => items.map((item) => item.summary);

  describe("права на журнал (матриця: власник і бухгалтер)", () => {
    it("читають власник і бухгалтер, решта ролей відмову", async () => {
      for (const role of USER_ROLES) {
        const attempt = listAuditEntries(t.db, t.users[role], {});
        if (ALLOWED_JOURNAL.includes(role)) await expect(attempt, role).resolves.toBeTruthy();
        else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("список користувачів для фільтра теж лише власнику й бухгалтеру", async () => {
      const actors = await listAuditActors(t.db, t.users.owner);
      expect(actors.map((a) => a.name)).toContain(t.users.owner.fullName);
      for (const role of USER_ROLES.filter((r) => !ALLOWED_JOURNAL.includes(r))) {
        await expect(listAuditActors(t.db, t.users[role]), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });
  });

  describe("зміст журналу", () => {
    it("нові записи першими; кожен має хто, коли, про що й речення; ідентифікаторів uuid немає", async () => {
      const page = await listAuditEntries(t.db, t.users.owner, {}, { limit: 100 });
      expect(page.items.length).toBeGreaterThan(20);
      const times = page.items.map((item) => item.at);
      expect([...times].sort().reverse()).toEqual(times);
      for (const item of page.items) {
        expect(item.actorName.length, item.id).toBeGreaterThan(0);
        expect(item.summary.length, item.id).toBeGreaterThan(0);
        expect(item.subject.length, item.id).toBeGreaterThan(0);
        const text = JSON.stringify([item.summary, item.subject, item.changes]);
        expect(text, `${item.summary} / ${item.subject}`).not.toMatch(UUID);
      }
    });

    it("зміна кг показується як «було → стало», статус словами, автор і заголовок із номером", async () => {
      const { items } = await listAuditEntries(t.db, t.users.owner, {
        search: String(orderNumber),
      });
      const kg = items.find((item) =>
        item.changes.some((c) => c.label === "Кількість на продаж" && c.before),
      );
      expect(kg).toMatchObject({
        actorName: t.users.manager.fullName,
        summary: "Змінено замовлення",
        subject: `Замовлення № ${orderNumber} · Кафе Тест`,
        href: `/orders/${orderId}`,
      });
      expect(kg!.changes).toContainEqual({
        label: "Кількість на продаж",
        before: "30 кг",
        after: "35 кг",
      });
      const status = items.find((item) => item.summary.startsWith("Змінено статус"));
      expect(status!.summary).toBe("Змінено статус: Чернетка → Підтверджено");
      expect(status!.actorName).toBe(t.users.owner.fullName);
    });

    it("позиції (також видалена), зміна ціни, «цех побачив» і системне закриття", async () => {
      const order = await listAuditEntries(t.db, t.users.owner, { search: String(orderNumber) });
      const all = summaries(order.items);
      expect(all).toContain("Створено позицію замовлення");
      expect(all).toContain("Видалено позицію замовлення");
      expect(all).toContain("Створено зміну ціни замовлення");
      expect(all).toContain("Цех побачив замовлення");
      const removed = order.items.find((i) => i.summary === "Видалено позицію замовлення")!;
      expect(removed.subject).toContain(`позиція «${deletedItemTitle}»`);
      expect(removed.changes).toContainEqual({
        label: "Назва",
        before: deletedItemTitle,
        after: null,
      });

      const cash = await listAuditEntries(t.db, t.users.owner, { section: "cash" });
      expect(summaries(cash.items)).toContain("Сторновано запис готівки");
      const closed = (
        await listAuditEntries(t.db, t.users.owner, { section: "orders" }, { limit: 100 })
      ).items.find((i) => i.summary === "Змінено статус: Оплачено → Закрито");
      expect(closed?.actorName).toBe("Система");
    });

    it("клієнт: створення, контакт, адреса, ціна клієнта, прайс", async () => {
      const clientEntries = await listAuditEntries(t.db, t.users.accountant, {
        search: clientCode,
      });
      const all = summaries(clientEntries.items);
      expect(all).toEqual(
        expect.arrayContaining([
          "Створено клієнта",
          "Створено контакт клієнта",
          "Створено адресу клієнта",
          "Створено ціну клієнта",
        ]),
      );
      expect(clientEntries.items[0]!.subject).toContain(`Клієнт ${clientCode} · Журнальний клієнт`);
      expect(
        clientEntries.items.find((i) => i.summary === "Створено контакт клієнта")!.subject,
      ).toContain("контакт «Марія»");
      const prices = await listAuditEntries(t.db, t.users.owner, { section: "prices" });
      expect(prices.items[0]).toMatchObject({
        summary: "Створено ціну прайсу",
        href: "/more/prices",
      });
      expect(prices.items[0]!.subject).toContain("3 мм");
    });
  });

  describe("фільтри", () => {
    it("розділ", async () => {
      const cash = await listAuditEntries(t.db, t.users.owner, { section: "cash" }, { limit: 100 });
      expect(cash.items.length).toBeGreaterThanOrEqual(3);
      expect(cash.items.every((i) => i.sectionLabel === "Готівка")).toBe(true);
      const users = await listAuditEntries(t.db, t.users.owner, { section: "users" });
      expect(users.items.every((i) => i.sectionLabel === "Користувачі")).toBe(true);
    });

    it("користувач", async () => {
      const lead = await listAuditEntries(
        t.db,
        t.users.owner,
        { actorId: t.users.location_lead.id },
        { limit: 100 },
      );
      expect(lead.items.length).toBeGreaterThan(0);
      expect(lead.items.every((i) => i.actorName === t.users.location_lead.fullName)).toBe(true);
    });

    it("дні за київським часом: сьогодні є, завтра й учора порожньо", async () => {
      const today = todayIso();
      expect(
        (await listAuditEntries(t.db, t.users.owner, { dateFrom: today, dateTo: today })).items
          .length,
      ).toBeGreaterThan(0);
      expect(
        (await listAuditEntries(t.db, t.users.owner, { dateFrom: addDays(today, 1) })).items,
      ).toEqual([]);
      expect(
        (await listAuditEntries(t.db, t.users.owner, { dateTo: addDays(today, -1) })).items,
      ).toEqual([]);
    });

    it("пошук за номером замовлення й кодом клієнта; нічого не знайдено дає порожньо", async () => {
      const byNumber = await listAuditEntries(t.db, t.users.owner, { search: String(orderNumber) });
      expect(byNumber.items.length).toBeGreaterThan(5);
      expect(byNumber.items.every((i) => i.subject.includes(`№ ${orderNumber}`))).toBe(true);
      const latin = clientCode.replace("АА", "AA");
      expect(
        (await listAuditEntries(t.db, t.users.owner, { search: latin })).items.length,
      ).toBeGreaterThan(0);
      expect((await listAuditEntries(t.db, t.users.owner, { search: "999999" })).items).toEqual([]);
      expect((await listAuditEntries(t.db, t.users.owner, { search: "ЯЯ9" })).items).toEqual([]);
    });

    it("поганий ввід дає зрозумілу помилку", async () => {
      await expect(
        listAuditEntries(t.db, t.users.owner, { dateFrom: "вчора" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(listAuditEntries(t.db, t.users.owner, { actorId: "xx" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        listAuditEntries(t.db, t.users.owner, { search: "а".repeat(80) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("довантаження", () => {
    it("сторінки не перетинаються, остання знає, що більше немає", async () => {
      const first = await listAuditEntries(t.db, t.users.owner, {}, { limit: 7, offset: 0 });
      const second = await listAuditEntries(t.db, t.users.owner, {}, { limit: 7, offset: 7 });
      expect(first.hasMore).toBe(true);
      const ids = new Set(first.items.map((i) => i.id));
      expect(second.items.every((i) => !ids.has(i.id))).toBe(true);
      const all = await listAuditEntries(t.db, t.users.owner, {}, { limit: 100 });
      const last = await listAuditEntries(
        t.db,
        t.users.owner,
        {},
        { limit: 50, offset: Math.max(all.items.length - 3, 0) },
      );
      expect(last.hasMore).toBe(all.hasMore);
    });
  });

  describe("історія на картці замовлення (D91)", () => {
    it("власник, менеджер і бухгалтер бачать зміни замовлення з позиціями, ціною й готівкою; чуже не потрапляє", async () => {
      for (const role of ALLOWED_HISTORY) {
        const { items } = await listEntityHistory(t.db, t.users[role as "owner"], {
          kind: "order",
          id: orderId,
        });
        const all = summaries(items);
        expect(all, role).toContain("Створено замовлення");
        expect(all, role).toContain("Видалено позицію замовлення");
        expect(all, role).toContain("Створено зміну ціни замовлення");
        expect(
          items.every((i) => i.subject.includes(`№ ${orderNumber}`)),
          role,
        ).toBe(true);
      }
      const cash = await listEntityHistory(t.db, t.users.manager, {
        kind: "order",
        id: cashOrderId,
      });
      expect(summaries(cash.items)).toContain("Сторновано запис готівки");
      const other = await listEntityHistory(t.db, t.users.owner, {
        kind: "order",
        id: otherOrderId,
      });
      expect(other.items.every((i) => !i.subject.includes(`№ ${orderNumber}`))).toBe(true);
    });

    it("старший локації, виробництво й водій історії не отримують ні для замовлення, ні для клієнта", async () => {
      for (const role of ["location_lead", "production", "driver"] as const) {
        await expect(
          listEntityHistory(t.db, t.users[role], { kind: "order", id: orderId }),
          role,
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(
          listEntityHistory(t.db, t.users[role], { kind: "client", id: clientId }),
          role,
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("неіснуюче замовлення чи клієнт, поганий id: помилка введення", async () => {
      await expect(
        listEntityHistory(t.db, t.users.owner, { kind: "order", id: "не-id" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        listEntityHistory(t.db, t.users.owner, {
          kind: "order",
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        listEntityHistory(t.db, t.users.owner, {
          kind: "client",
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("історія на картці клієнта", () => {
    it("власник, менеджер і бухгалтер бачать створення, контакт, адресу й ціну клієнта", async () => {
      for (const role of ALLOWED_HISTORY) {
        const { items } = await listEntityHistory(t.db, t.users[role as "owner"], {
          kind: "client",
          id: clientId,
        });
        expect(summaries(items), role).toEqual(
          expect.arrayContaining([
            "Створено клієнта",
            "Створено контакт клієнта",
            "Створено адресу клієнта",
            "Створено ціну клієнта",
          ]),
        );
      }
    });

    it("ліміт обмежує список і повідомляє, що є ще", async () => {
      const page = await listEntityHistory(
        t.db,
        t.users.owner,
        { kind: "client", id: clientId },
        { limit: 2 },
      );
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
    });
  });
});
