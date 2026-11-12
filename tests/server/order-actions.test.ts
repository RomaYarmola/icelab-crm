import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addOrderItemAction,
  cancelAsDuplicateAction,
  changeOrderPriceAction,
  createOrderAction,
  deleteDraftOrderAction,
  deleteOrderItemAction,
  findDuplicateOrdersAction,
  loadMoreOrdersAction,
  repeatLastOrderAction,
  transitionOrderAction,
  updateOrderAction,
  updateOrderItemAction,
} from "@/app/(app)/orders/actions";
import { getDb } from "@/db/client";
import { orderItems, orders } from "@/db/schema";
import { requireUser } from "@/server/auth";
import type { UserRole } from "@/server/permissions";
import { INITIAL_FORM_STATE, type FormState } from "@/utils/formState";
import { ORDER_DATE, type OrderTestContext, setupOrderTests } from "./order-helpers";

vi.mock("@/server/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const run = (
  action: (previous: FormState, data: FormData) => Promise<FormState>,
  fields: Record<string, string>,
) => action(INITIAL_FORM_STATE, form(fields));

/** Дія з redirect кидає службову помилку Next.js: дістаємо з неї адресу переходу. */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw error;
  }
  throw new Error("Перехід не відбувся");
}

describe("серверні дії розділу «Замовлення»", () => {
  let t: OrderTestContext;
  const as = (role: UserRole) => vi.mocked(requireUser).mockResolvedValue(t.users[role]);

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue(t.db as unknown as ReturnType<typeof getDb>);
    as("manager");
  });

  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const base = () => ({
    clientId: t.client.id,
    locationId: t.location,
    orderDate: ORDER_DATE,
    iceTypeId: t.ice16,
    kgSold: "30",
    deliveryMethod: "np",
  });

  describe("створення і зміна", () => {
    it("менеджер створює замовлення: ціна з прайсу, надбавка, перехід на картку", async () => {
      const target = await redirectOf(
        run(createOrderAction, { ...base(), recipientPhone: "050 123 45 67", comment: "До 10:00" }),
      );
      const created = (await t.db.select().from(orders).where(eq(orders.comment, "До 10:00")))[0]!;
      expect(target).toBe(`/orders/${created.id}?created=1`);
      expect(created).toMatchObject({
        status: "draft",
        kgToProduce: "33.000",
        recipientPhone: "+380501234567",
        total: "2250.00",
      });
    });

    it("помилка введення повертається з введеним, без створення", async () => {
      const state = await run(createOrderAction, {
        ...base(),
        kgSold: "багато",
        comment: "Зберегти текст",
      });
      expect(state).toMatchObject({ status: "error", message: "Кілограми мають бути числом." });
      expect(state.values).toMatchObject({ comment: "Зберегти текст", kgSold: "багато" });
    });

    it("роль без права отримує відмову, а не збій", async () => {
      as("location_lead");
      expect(await run(createOrderAction, base())).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
    });

    it("зміна з форми: надіслані поля міняються, порожні тексти очищаються, ціна «за прайсом»", async () => {
      const { id } = await t.create({ comment: "Старий" });
      expect(
        await run(updateOrderAction, { id, kgSold: "40", comment: "", price: "70" }),
      ).toMatchObject({ status: "success" });
      expect(await row(id)).toMatchObject({
        kgSold: "40.000",
        comment: null,
        priceManual: true,
        total: "2800.00",
      });
      await run(updateOrderAction, { id, price: "" });
      expect(await row(id)).toMatchObject({ priceManual: false, total: "3000.00" });
    });

    it("зміна у виробництві без примітки: повідомлення, з приміткою проходить", async () => {
      const { id } = await t.create();
      await run(transitionOrderAction, { id, to: "confirmed" });
      as("production");
      await run(transitionOrderAction, { id, to: "in_production" });
      as("owner");
      expect((await run(updateOrderAction, { id, kgSold: "20" })).message).toContain(
        "вкажіть причину",
      );
      expect(
        await run(updateOrderAction, { id, kgSold: "20", note: "Клієнт зменшив" }),
      ).toMatchObject({ status: "success" });
    });

    it("поганий ідентифікатор: «Замовлення не знайдено.»", async () => {
      expect((await run(updateOrderAction, { id: "x", kgSold: "1" })).message).toBe(
        "Замовлення не знайдено.",
      );
    });
  });

  describe("статуси, ціна, видалення, дублі", () => {
    it("перехід за формою, причина скасування обов'язкова", async () => {
      const { id } = await t.create();
      expect(await run(transitionOrderAction, { id, to: "confirmed" })).toMatchObject({
        status: "success",
      });
      expect((await row(id)).pricePerKgSnapshot).toBe("75.00");
      expect((await run(transitionOrderAction, { id, to: "cancelled" })).message).toBe(
        "Вкажіть причину скасування.",
      );
      expect((await run(transitionOrderAction, { id, to: "nonsense" })).message).toBe(
        "Оберіть, у який статус перевести замовлення.",
      );
      expect(
        await run(transitionOrderAction, { id, to: "cancelled", note: "Клієнт передумав" }),
      ).toMatchObject({ status: "success" });
    });

    it("ціну після підтвердження змінює лише власник з приміткою", async () => {
      const { id } = await t.create();
      await run(transitionOrderAction, { id, to: "confirmed" });
      expect(
        await run(changeOrderPriceAction, { id, pricePerKg: "70", note: "Знижка" }),
      ).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
      as("owner");
      expect((await run(changeOrderPriceAction, { id, pricePerKg: "70", note: "" })).message).toBe(
        "Вкажіть причину зміни ціни.",
      );
      expect(
        await run(changeOrderPriceAction, { id, pricePerKg: "70", note: "Знижка" }),
      ).toMatchObject({ status: "success" });
      expect((await row(id)).pricePerKgSnapshot).toBe("70.00");
    });

    it("чернетку видаляє менеджер з переходом до списку, підтверджене ні", async () => {
      const draft = await t.create();
      expect(await redirectOf(run(deleteDraftOrderAction, { id: draft.id }))).toBe("/orders");
      const confirmed = await t.create();
      await run(transitionOrderAction, { id: confirmed.id, to: "confirmed" });
      expect((await run(deleteDraftOrderAction, { id: confirmed.id })).message).toContain(
        "лише чернетку",
      );
    });

    it("«Це дубль»: скасування з переходом до першого замовлення", async () => {
      const first = await t.create();
      const second = await t.create();
      expect(
        await redirectOf(run(cancelAsDuplicateAction, { id: second.id, originalId: first.id })),
      ).toBe(`/orders/${first.id}`);
      expect(await row(second.id)).toMatchObject({ status: "cancelled", duplicateOf: first.id });
    });
  });

  describe("позиції", () => {
    it("додати, змінити, видалити; помилки з повідомленням", async () => {
      const { id } = await t.create();
      expect(
        await run(addOrderItemAction, {
          orderId: id,
          kind: "delivery",
          title: "Доставка",
          qty: "1",
          price: "150",
        }),
      ).toMatchObject({ status: "success" });
      const item = (await t.db.select().from(orderItems).where(eq(orderItems.orderId, id))).find(
        (i) => i.kind === "delivery",
      )!;
      expect((await row(id)).total).toBe("2400.00");
      expect(
        await run(updateOrderItemAction, {
          id: item.id,
          title: "Доставка за місто",
          qty: "1",
          price: "200",
        }),
      ).toMatchObject({ status: "success" });
      expect((await row(id)).total).toBe("2450.00");
      expect(
        (
          await run(addOrderItemAction, {
            orderId: id,
            kind: "delivery",
            title: "",
            qty: "1",
            price: "1",
          })
        ).message,
      ).toBe("Вкажіть назву позиції.");
      expect(await run(deleteOrderItemAction, { id: item.id })).toMatchObject({
        status: "success",
      });
      expect((await row(id)).total).toBe("2250.00");
    });
  });

  describe("читання для екранів", () => {
    it("«Показати ще»: частина списку, помилки без збою, відмова ролі", async () => {
      const first = await loadMoreOrdersAction({ offset: 0 });
      expect(first.ok && first.page.items.length).toBeGreaterThan(0);
      expect(await loadMoreOrdersAction({ offset: 0, statuses: ["x"] })).toEqual({
        ok: false,
        message: "Невідомий статус.",
      });
      expect((await loadMoreOrdersAction({ offset: -1 })).ok).toBe(false);
      as("production");
      expect(await loadMoreOrdersAction({ offset: 0 })).toEqual({
        ok: false,
        message: "Недостатньо прав для цієї дії.",
      });
    });

    it("підказки: дублі й «як минулого разу», помилки дають порожній результат", async () => {
      await t.create({ orderDate: "2026-12-10" });
      const found = await findDuplicateOrdersAction({
        clientId: t.client.id,
        orderDate: "2026-12-10",
        iceTypeId: t.ice16,
      });
      expect(found.length).toBeGreaterThan(0);
      expect(await findDuplicateOrdersAction({ clientId: "ні", orderDate: "2026-12-10" })).toEqual(
        [],
      );
      expect(await repeatLastOrderAction(t.client.id)).toMatchObject({ iceTypeId: t.ice16 });
      expect(await repeatLastOrderAction("ні")).toBeNull();
      as("accountant");
      expect(
        await findDuplicateOrdersAction({ clientId: t.client.id, orderDate: "2026-12-10" }),
      ).toEqual([]);
      expect(await repeatLastOrderAction(t.client.id)).toBeNull();
    });
  });
});
