import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordCashEntryAction, reverseCashEntryAction } from "@/app/(app)/more/cash/actions";
import { markAllSeenAction, openProductionScreenAction } from "@/app/(app)/production/actions";
import { getDb } from "@/db/client";
import { cashEntries, orders } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { transitionOrder } from "@/server/order-status";
import type { UserRole } from "@/server/permissions";
import { INITIAL_FORM_STATE, type FormState } from "@/utils/formState";
import { todayIso } from "@/utils/isoDate";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

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

describe("серверні дії готівки і екрана виробництва (B6)", () => {
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
    as("location_lead");
  });

  const shippedCashOrder = async (orderDate: string = todayIso()) => {
    const { id } = await t.create({ paymentKind: "cash", orderDate });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    await transitionOrder(t.db, t.users.location_lead, id, "in_production");
    await transitionOrder(t.db, t.users.location_lead, id, "packed");
    await transitionOrder(t.db, t.users.location_lead, id, "shipped");
    return id;
  };
  const row = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

  describe("«Прийнято готівку»", () => {
    it("старший локації записує частину: успіх, запис у базі", async () => {
      const id = await shippedCashOrder();
      const state = await run(recordCashEntryAction, {
        orderId: id,
        amount: "1000,50",
        receivedBy: "Водій Іван",
        note: "Доставка",
      });
      expect(state).toMatchObject({ status: "success", message: "Готівку записано." });
      const [entry] = await t.db.select().from(cashEntries).where(eq(cashEntries.orderId, id));
      expect(entry).toMatchObject({
        amount: "1000.50",
        receivedByText: "Водій Іван",
        note: "Доставка",
        enteredBy: t.users.location_lead.id,
      });
    });

    it("переплата повертає помилку з підказкою й введеним", async () => {
      const id = await shippedCashOrder();
      const state = await run(recordCashEntryAction, { orderId: id, amount: "5000" });
      expect(state).toMatchObject({ status: "error" });
      expect(state.message).toMatch(/лишилось 2\s250\s₴/);
      expect(state.values).toMatchObject({ amount: "5000" });
    });

    it("повна сума ставить «Оплачено» і закриває замовлення", async () => {
      const id = await shippedCashOrder();
      await run(recordCashEntryAction, { orderId: id, amount: "2250" });
      expect((await row(id)).status).toBe("closed");
    });

    it("без замовлення, з поганою сумою й без прав: зрозумілі повідомлення", async () => {
      expect(await run(recordCashEntryAction, { amount: "10" })).toMatchObject({
        status: "error",
        message: "Замовлення не знайдено.",
      });
      const id = await shippedCashOrder();
      expect(await run(recordCashEntryAction, { orderId: id, amount: "abc" })).toMatchObject({
        status: "error",
        message: "Сума має бути числом, наприклад 450 або 450,50.",
      });
      as("production");
      expect(await run(recordCashEntryAction, { orderId: id, amount: "10" })).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
    });
  });

  describe("сторно", () => {
    it("лише власник, з причиною", async () => {
      const id = await shippedCashOrder();
      await run(recordCashEntryAction, { orderId: id, amount: "500" });
      const [entry] = await t.db.select().from(cashEntries).where(eq(cashEntries.orderId, id));

      expect(
        await run(reverseCashEntryAction, { entryId: entry!.id, reason: "Помилка" }),
      ).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });

      as("owner");
      expect(await run(reverseCashEntryAction, { entryId: entry!.id, reason: " " })).toMatchObject({
        status: "error",
        message: "Вкажіть причину сторно.",
      });
      expect(
        await run(reverseCashEntryAction, { entryId: entry!.id, reason: "Помилка" }),
      ).toMatchObject({ status: "success", message: "Запис сторновано." });
      expect(
        (await t.db.select().from(cashEntries).where(eq(cashEntries.id, entry!.id)))[0]!.reversedAt,
      ).toBeInstanceOf(Date);
    });

    it("поганий ідентифікатор не ламає дію", async () => {
      as("owner");
      expect(await run(reverseCashEntryAction, { entryId: "xx", reason: "Причина" })).toMatchObject(
        { status: "error", message: "Запис не знайдено." },
      );
    });
  });

  describe("відкриття екрана виробництва", () => {
    it("цех запускає замовлення на сьогодні й позначає показані як побачені", async () => {
      const today = todayIso();
      const { id } = await t.create({ orderDate: today });
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
      as("production");
      const result = await openProductionScreenAction({ date: today, seenOrderIds: [id] });
      expect(result).toEqual({ status: "ok", started: 1, marked: 1 });
      expect(await row(id)).toMatchObject({ status: "in_production" });
      expect((await row(id)).seenByProductionAt).toBeInstanceOf(Date);
    });

    it("замовлення, які не були показані, не позначаються", async () => {
      const today = todayIso();
      const shown = await t.create({ orderDate: today });
      const late = await t.create({ orderDate: today });
      for (const { id } of [shown, late])
        await transitionOrder(t.db, t.users.owner, id, "confirmed");
      as("location_lead");
      await openProductionScreenAction({ date: today, seenOrderIds: [shown.id] });
      expect((await row(late.id)).seenByProductionAt).toBeNull();
    });

    it("власник, менеджер і бухгалтер екран «не відкривають»: нічого не змінюється", async () => {
      const today = todayIso();
      const { id } = await t.create({ orderDate: today });
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
      for (const role of ["owner", "manager", "accountant"] as const) {
        as(role);
        expect(await openProductionScreenAction({ date: today, seenOrderIds: [id] })).toEqual({
          status: "ok",
          started: 0,
          marked: 0,
        });
      }
      expect((await row(id)).status).toBe("confirmed");
    });

    it("не сьогоднішній день нічого не запускає, але «нове» знімає", async () => {
      const { id } = await t.create({ orderDate: "2031-05-05" });
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
      const result = await openProductionScreenAction({ date: "2031-05-05", seenOrderIds: [id] });
      expect(result).toEqual({ status: "ok", started: 0, marked: 1 });
      expect((await row(id)).status).toBe("confirmed");
    });

    it("поганий список замовлень повертає помилку, а не збій", async () => {
      expect(
        await openProductionScreenAction({ date: todayIso(), seenOrderIds: ["не-ідентифікатор"] }),
      ).toMatchObject({ status: "error" });
    });
  });

  describe("«Позначити всі побаченими»", () => {
    it("знімає «Нове» з усього дня; власнику відмова", async () => {
      const { id } = await t.create({ orderDate: "2031-06-06" });
      await transitionOrder(t.db, t.users.owner, id, "confirmed");
      as("owner");
      expect(await run(markAllSeenAction, { date: "2031-06-06" })).toMatchObject({
        status: "error",
        message: "Недостатньо прав для цієї дії.",
      });
      as("production");
      expect(await run(markAllSeenAction, { date: "2031-06-06" })).toMatchObject({
        status: "success",
      });
      expect((await row(id)).seenByProductionAt).toBeInstanceOf(Date);
    });
  });
});
