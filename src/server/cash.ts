import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { cashEntries, clients, locations, orders, profiles } from "@/db/schema";
import type { OrderStatus } from "@/constants/constants";
import type { AnyPgDatabase } from "@/db/types";
import { isIsoDate, todayIso } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import {
  cashAmountProblem,
  cashReceivingProblem,
  kopecksToUah,
  parseCashAmount,
  summarizeCash,
} from "./cash-rules";
import { loadCashSummary, loadCashTolerance, settleCashPayment } from "./cash-settlement";
import { parseInput, ValidationError } from "./errors";
import { ForbiddenError, type AppUser, locationScope, requirePermission } from "./guards";
import { closeIfDone } from "./order-status";
import { loadOrderRow } from "./orders";
import { isBotOnly } from "./permissions";
import { z } from "zod";

/**
 * Готівка по замовленню (B6, D67–D69). Запис додають, але не міняють і не видаляють: помилку
 * виправляє власник сторно з причиною. Коли прийнято всю суму (з допуском) і замовлення вже
 * відправлене, воно саме стає «Оплачено» (а далі діє автозакриття з B5).
 *
 * Відповіді названі так, щоб їх можна було віддати старшому локації (D68): він бачить лише суму до
 * сплати й прийняте (`amountDue`, `receivedSum`), а ціни за кг, позиції й склад суми не отримує.
 */

const uuid = z.string().uuid("Некоректний ідентифікатор.");

export type RecordCashInput = {
  orderId: string;
  /** «450», «450,50». */
  amount: string | number;
  /** Хто прийняв, якщо не той, хто вносить запис (наприклад, водій). */
  receivedBy?: string | null;
  note?: string | null;
  /** Дата прийому (за замовчуванням сьогодні за Києвом, не з майбутнього). */
  receivedOn?: string;
  /** Звідки запис: водій вносить лише через Telegram-бота (B12). */
  via?: "web" | "driver_bot";
};

export type RecordCashResult = {
  entryId: string;
  status: OrderStatus;
  /** Скільки ще не прийнято після цього запису, гривні рядком. */
  remainingSum: string;
  /** Замовлення стало «Оплачено» цим записом. */
  settled: boolean;
};

const text = (value: string | null | undefined, max: number, label: string): string | null => {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > max) throw new ValidationError(`${label}: не більше ${max} символів.`);
  return trimmed;
};

/**
 * Записує прийняту готівку. Права: `order_cash` на запис, лише у своїй локації для старшого локації;
 * водій лише через бота. Сума не може бути більшою за залишок (переплату не приймаємо). Усе в одній
 * транзакції з блокуванням замовлення: двоє не приймуть останню суму одночасно.
 */
export async function recordCashEntry(
  db: AnyPgDatabase,
  actor: AppUser,
  input: RecordCashInput,
): Promise<RecordCashResult> {
  const orderId = parseInput(uuid, input.orderId);
  const via = input.via ?? "web";
  const order = await loadOrderRow(db, orderId);
  requirePermission(actor, "order_cash", "write", { recordLocationId: order.locationId });
  if (isBotOnly(actor.role, "order_cash") && via !== "driver_bot") throw new ForbiddenError();

  const amount = parseCashAmount(input.amount);
  if ("error" in amount) throw new ValidationError(amount.error);
  const today = todayIso();
  const receivedOn = input.receivedOn ?? today;
  if (!isIsoDate(receivedOn)) throw new ValidationError("Некоректна дата прийому.");
  if (receivedOn > today) throw new ValidationError("Дата прийому не може бути в майбутньому.");
  const receivedBy = text(input.receivedBy, 120, "Хто прийняв");
  const note = text(input.note, 500, "Примітка");

  let settled = false as boolean;
  const result = await withActor(db, actor.id, async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (!current || current.deletedAt) throw new ValidationError("Замовлення не знайдено.");
    const problem = cashReceivingProblem(current);
    if (problem) throw new ValidationError(problem);

    const summary = await loadCashSummary(tx, current);
    const amountProblem = cashAmountProblem(amount.kopecks, summary.remaining);
    if (amountProblem) throw new ValidationError(amountProblem);

    const [entry] = await tx
      .insert(cashEntries)
      .values({
        orderId: current.id,
        locationId: current.locationId,
        amount: kopecksToUah(amount.kopecks),
        receivedOn,
        receivedByText: receivedBy,
        enteredBy: actor.id,
        enteredVia: via,
        note,
      })
      .returning({ id: cashEntries.id });

    settled = await settleCashPayment(tx, current);
    const after = await loadCashSummary(tx, current);
    const [latest] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, current.id));
    return {
      entryId: entry!.id,
      status: latest?.status ?? current.status,
      remainingSum: kopecksToUah(after.remaining),
    };
  });

  // Оплачене замовлення без боргу по боксах закриваємо автоматично (D51).
  if (settled) await closeIfDone(db, order.id);
  const [latest] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, order.id));
  return { ...result, status: latest?.status ?? result.status, settled };
}

/**
 * Сторно запису готівки (D69): лише власник і лише з причиною. Запис лишається в журналі, позначений
 * скасованим, у підсумках не рахується. Якщо замовлення вже «Оплачено» чи «Закрито», власник спершу
 * повертає його на крок назад (правило B5), інакше підсумок розійшовся б зі статусом.
 */
export async function reverseCashEntry(
  db: AnyPgDatabase,
  actor: AppUser,
  entryId: string,
  reason: string,
): Promise<void> {
  requirePermission(actor, "cash_reversal", "write");
  const id = parseInput(uuid, entryId);
  const why = reason.trim();
  if (why === "") throw new ValidationError("Вкажіть причину сторно.");
  if (why.length > 500) throw new ValidationError("Причина: не більше 500 символів.");

  await withActor(db, actor.id, async (tx) => {
    const [entry] = await tx.select().from(cashEntries).where(eq(cashEntries.id, id)).for("update");
    if (!entry) throw new ValidationError("Запис готівки не знайдено.");
    if (entry.reversedAt) throw new ValidationError("Цей запис уже сторновано.");

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, entry.orderId))
      .for("update");
    if (order && (order.status === "paid" || order.status === "closed")) {
      throw new ValidationError(
        "Замовлення вже оплачене. Щоб сторнувати запис, спершу поверніть замовлення зі статусу «Оплачено» на крок назад.",
      );
    }
    await tx
      .update(cashEntries)
      .set({ reversedAt: new Date(), reversedBy: actor.id, reversalReason: why })
      .where(eq(cashEntries.id, id));
  });
}

// ---------------------------------------------------------------------------------------------
// Читання: що ще не сплачено і підсумок дня
// ---------------------------------------------------------------------------------------------

export type CashEntryView = {
  id: string;
  sumReceived: string;
  receivedOn: string;
  /** Хто прийняв: текст запису (водій) або той, хто вніс. */
  receivedBy: string;
  enteredVia: "web" | "driver_bot";
  note: string | null;
  isReversed: boolean;
  reversalReason: string | null;
};

export type CashOrderView = {
  id: string;
  number: number | null;
  clientCode: string;
  clientName: string;
  locationId: string;
  locationName: string;
  status: OrderStatus;
  orderDate: string;
  deliveryMethod: "pickup" | "our_delivery" | "np" | "bus" | "other";
  /** Сума до сплати: загальна сума замовлення (D68), без цін за кг і складу суми. */
  amountDue: string;
  receivedSum: string;
  remainingSum: string;
  isPaid: boolean;
  /** Щось прийнято, але ще не все. */
  isPartial: boolean;
  entries: CashEntryView[];
};

export type CashDaySummary = {
  /** Мало надійти: сума замовлень дня з готівковою оплатою. */
  expectedSum: string;
  /** Внесено: прийнято по цих замовленнях (без сторнованих). */
  enteredSum: string;
  /** Різниця: expected мінус entered, не менше нуля. */
  differenceSum: string;
  /** Прийнято в цей день за датою прийому (за всіма замовленнями). */
  receivedOnDaySum: string;
  /** Хто скільки прийняв цього дня. */
  byReceiver: { name: string; sumReceived: string }[];
};

export type CashDay = {
  date: string;
  locationId: string | null;
  orders: CashOrderView[];
  summary: CashDaySummary;
};

/** Статуси замовлень, які бувають в обліку готівки: підтверджені й далі, без чернеток і скасованих. */
const CASH_ORDER_STATUSES: OrderStatus[] = [
  "confirmed",
  "in_production",
  "packed",
  "shipped",
  "paid",
  "closed",
];

/**
 * Готівка за день і локацією (ТЗ 6.6): замовлення з готівковою оплатою на цю дату, по кожному сума до
 * сплати, прийняте й залишок, та підсумок «мало надійти / внесено / різниця». Читати можуть власник,
 * менеджер, бухгалтер і старший локації (лише своєї локації).
 */
export async function listCashDay(
  db: AnyPgDatabase,
  actor: AppUser,
  scope: { date: string; locationId?: string | null },
): Promise<CashDay> {
  requirePermission(actor, "order_cash", "read", { anyLocation: true });
  if (!isIsoDate(scope.date)) throw new ValidationError("Некоректна дата.");
  const locationId = locationScope(actor) ?? scope.locationId ?? null;

  const conditions = [
    eq(orders.orderDate, scope.date),
    eq(orders.paymentKind, "cash"),
    inArray(orders.status, CASH_ORDER_STATUSES),
    isNull(orders.deletedAt),
  ];
  if (locationId) conditions.push(eq(orders.locationId, locationId));

  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      clientCode: clients.code,
      clientName: clients.name,
      locationId: orders.locationId,
      locationName: locations.name,
      status: orders.status,
      orderDate: orders.orderDate,
      deliveryMethod: orders.deliveryMethod,
      total: orders.total,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .where(and(...conditions))
    .orderBy(asc(orders.number));

  const tolerance = await loadCashTolerance(db);
  const entryRows = rows.length
    ? await db
        .select({
          id: cashEntries.id,
          orderId: cashEntries.orderId,
          amount: cashEntries.amount,
          receivedOn: cashEntries.receivedOn,
          receivedByText: cashEntries.receivedByText,
          enteredByName: profiles.fullName,
          enteredVia: cashEntries.enteredVia,
          note: cashEntries.note,
          reversedAt: cashEntries.reversedAt,
          reversalReason: cashEntries.reversalReason,
          createdAt: cashEntries.createdAt,
        })
        .from(cashEntries)
        .innerJoin(profiles, eq(profiles.id, cashEntries.enteredBy))
        .where(
          inArray(
            cashEntries.orderId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(cashEntries.createdAt))
    : [];

  const toEntryView = (entry: (typeof entryRows)[number]): CashEntryView => ({
    id: entry.id,
    sumReceived: entry.amount,
    receivedOn: entry.receivedOn,
    receivedBy: entry.receivedByText ?? entry.enteredByName,
    enteredVia: entry.enteredVia,
    note: entry.note,
    isReversed: entry.reversedAt !== null,
    reversalReason: entry.reversalReason,
  });

  let expected = 0;
  let entered = 0;
  const orderViews: CashOrderView[] = rows.map((row) => {
    const own = entryRows.filter((entry) => entry.orderId === row.id);
    const summary = summarizeCash(
      row.total,
      own.map((entry) => ({ amount: entry.amount, reversed: entry.reversedAt !== null })),
      tolerance,
    );
    expected += summary.total;
    entered += summary.received;
    return {
      id: row.id,
      number: row.number,
      clientCode: row.clientCode,
      clientName: row.clientName,
      locationId: row.locationId,
      locationName: row.locationName,
      status: row.status,
      orderDate: row.orderDate,
      deliveryMethod: row.deliveryMethod,
      amountDue: kopecksToUah(summary.total),
      receivedSum: kopecksToUah(summary.received),
      remainingSum: kopecksToUah(summary.remaining),
      isPaid: summary.paid,
      isPartial: summary.partial,
      entries: own.map(toEntryView),
    };
  });

  // Прийнято цього дня за датою прийому (будь-які замовлення локації), без сторнованих.
  const receivedConditions = [
    eq(cashEntries.receivedOn, scope.date),
    isNull(cashEntries.reversedAt),
  ];
  if (locationId) receivedConditions.push(eq(cashEntries.locationId, locationId));
  const receivedToday = await db
    .select({
      amount: cashEntries.amount,
      receivedByText: cashEntries.receivedByText,
      enteredByName: profiles.fullName,
    })
    .from(cashEntries)
    .innerJoin(profiles, eq(profiles.id, cashEntries.enteredBy))
    .where(and(...receivedConditions))
    .orderBy(desc(cashEntries.createdAt));

  const byReceiver = new Map<string, number>();
  let receivedOnDay = 0;
  for (const entry of receivedToday) {
    const kopecks = Math.round(parseDecimal(entry.amount) * 100);
    receivedOnDay += kopecks;
    const name = entry.receivedByText ?? entry.enteredByName;
    byReceiver.set(name, (byReceiver.get(name) ?? 0) + kopecks);
  }

  return {
    date: scope.date,
    locationId,
    orders: orderViews,
    summary: {
      expectedSum: kopecksToUah(expected),
      enteredSum: kopecksToUah(entered),
      differenceSum: kopecksToUah(Math.max(expected - entered, 0)),
      receivedOnDaySum: kopecksToUah(receivedOnDay),
      byReceiver: [...byReceiver.entries()]
        .map(([name, kopecks]) => ({ name, sumReceived: kopecksToUah(kopecks) }))
        .sort((a, b) => a.name.localeCompare(b.name, "uk")),
    },
  };
}

/**
 * Готівка по одному замовленню (для кнопки «Готівка» на картці): та сама форма, що в списку дня.
 * Повертає `null`, якщо замовлення не з готівковою оплатою чи ще не підтверджене.
 */
export async function getOrderCash(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<CashOrderView | null> {
  const order = await loadOrderRow(db, parseInput(uuid, orderId));
  requirePermission(actor, "order_cash", "read", { recordLocationId: order.locationId });
  const day = await listCashDay(db, actor, {
    date: order.orderDate,
    locationId: order.locationId,
  });
  return day.orders.find((item) => item.id === order.id) ?? null;
}
