import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { clients, orders, paymentMatches, payments, settings } from "@/db/schema";
import { withActor } from "@/db/actor";
import { todayIso } from "@/utils/isoDate";
import { ValidationError } from "./errors";
import type { AnyPgDatabase } from "@/db/types";
import type { PaymentParams } from "@/utils/paymentParams";
import { toKopecks, kopecksToUah } from "./cash-rules";
import { loadCashTolerance } from "./cash-settlement";
import { type AppUser, requirePermission } from "./guards";
import { namesMatch, suggestOrders, type OrderSuggestion } from "./payment-rules";
import { loadCandidates, orderPaymentProblem, numbersOfPayment } from "./payments";

/**
 * Читання платежів для екрана «Оплати» (B13, ТЗ 6.10): виписка з фільтрами й черга «Нерозпізнані»
 * з підказками. Лише власник і бухгалтер (`bank_payments`, D193). У відповідях немає сирої відповіді
 * банку (`raw`) і рахунку платника.
 */

export const PAGE_SIZE = 30;

export type PaymentMatchView = {
  orderId: string;
  orderNumber: number | null;
  clientName: string;
  amount: string;
  rule: "comment_number" | "amount_date_name" | "manual";
};

export type PaymentView = {
  id: string;
  occurredAt: Date;
  amount: string;
  counterName: string | null;
  description: string | null;
  comment: string | null;
  matchStatus: "unmatched" | "auto" | "manual" | "ignored";
  ignoredReason: string | null;
  importedVia: "api" | "file";
  /** Скільки ще не розкладено по замовленнях, гривні рядком. */
  unallocated: string;
  matches: PaymentMatchView[];
};

async function toViews(
  db: AnyPgDatabase,
  rows: (typeof payments.$inferSelect)[],
): Promise<PaymentView[]> {
  if (rows.length === 0) return [];
  const matches = await db
    .select({
      paymentId: paymentMatches.paymentId,
      orderId: paymentMatches.orderId,
      orderNumber: orders.number,
      clientName: clients.name,
      amount: paymentMatches.amount,
      rule: paymentMatches.rule,
    })
    .from(paymentMatches)
    .innerJoin(orders, eq(orders.id, paymentMatches.orderId))
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(
      inArray(
        paymentMatches.paymentId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) => {
    const own = matches.filter((match) => match.paymentId === row.id);
    const allocated = own.reduce((sum, match) => sum + toKopecks(match.amount), 0);
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      amount: row.amount,
      counterName: row.counterName,
      description: row.description,
      comment: row.comment,
      matchStatus: row.matchStatus,
      ignoredReason: row.ignoredReason,
      importedVia: row.importedVia,
      unallocated: kopecksToUah(Math.max(toKopecks(row.amount) - allocated, 0)),
      matches: own.map((match) => ({
        orderId: match.orderId,
        orderNumber: match.orderNumber,
        clientName: match.clientName,
        amount: match.amount,
        rule: match.rule as PaymentMatchView["rule"],
      })),
    };
  });
}

const kyivDay = sql`((${payments.occurredAt} at time zone 'Europe/Kyiv')::date)`;

export type StatementPage = {
  rows: PaymentView[];
  total: number;
  page: number;
  pageSize: number;
};

/** Вкладка «Виписка»: платежі з фільтрами за статусом, днем (за Києвом) і сумою; найновіші першими. */
export async function listStatement(
  db: AnyPgDatabase,
  actor: AppUser,
  params: Pick<PaymentParams, "status" | "from" | "to" | "min" | "max" | "page">,
): Promise<StatementPage> {
  requirePermission(actor, "bank_payments", "read");
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(payments.matchStatus, params.status));
  if (params.from) conditions.push(sql`${kyivDay} >= ${params.from}`);
  if (params.to) conditions.push(sql`${kyivDay} <= ${params.to}`);
  if (params.min !== null) conditions.push(gte(payments.amount, String(params.min)));
  if (params.max !== null) conditions.push(lte(payments.amount, String(params.max)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(where);
  const rows = await db
    .select()
    .from(payments)
    .where(where)
    .orderBy(desc(payments.occurredAt), desc(payments.createdAt))
    .limit(PAGE_SIZE)
    .offset((params.page - 1) * PAGE_SIZE);
  return {
    rows: await toViews(db, rows),
    total: count?.n ?? 0,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export type QueueSuggestion = {
  orderId: string;
  number: number | null;
  clientName: string;
  orderDate: string;
  remaining: string;
  reasons: OrderSuggestion["reasons"];
  /** Скільки з платежу піде на це замовлення за одним натисканням, гривні рядком. */
  apply: string;
};

/** Замовлення, назване в призначенні платежу, і чи його можна оплатити (D198). */
export type NamedOrder = {
  number: number;
  orderId: string | null;
  clientName: string | null;
  remaining: string | null;
  /** Чому не можна оплатити; `null`, якщо можна. */
  problem: string | null;
};

/** Замовлення клієнта, чия назва збігається з платником: для вибору зі списку (платіж без номерів). */
export type ClientOrderOption = {
  orderId: string;
  number: number | null;
  clientName: string;
  orderDate: string;
  remaining: string;
};

export type QueueItem = {
  payment: PaymentView;
  suggestions: QueueSuggestion[];
  named: NamedOrder[];
  clientOrders: ClientOrderOption[];
};

/** Вкладка «Нерозпізнані»: платежі, розкладені не повністю, з підказками замовлень. */
export async function listQueue(db: AnyPgDatabase, actor: AppUser): Promise<QueueItem[]> {
  requirePermission(actor, "bank_payments", "read");
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.matchStatus, "unmatched"))
    .orderBy(desc(payments.occurredAt));
  const views = await toViews(db, rows);
  if (views.length === 0) return [];
  const [candidates, tolerance] = await Promise.all([
    loadCandidates(db),
    loadCashTolerance(db).then((value) => Math.round(value * 100)),
  ]);
  const named = await describeNamedOrders(db, views);
  return views.map((payment) => {
    const unallocated = toKopecks(payment.unallocated);
    const suggestions = suggestOrders(
      {
        occurredAt: payment.occurredAt,
        comment: payment.comment,
        description: payment.description,
        counterName: payment.counterName,
        unallocatedKopecks: unallocated,
      },
      // Замовлення, до яких платіж уже прив'язаний, повторно не пропонуємо.
      candidates.filter((order) => !payment.matches.some((m) => m.orderId === order.id)),
      tolerance,
    ).map(({ order, reasons }) => ({
      orderId: order.id,
      number: order.number,
      clientName: order.clientName,
      orderDate: order.orderDate,
      remaining: kopecksToUah(order.remainingKopecks),
      reasons,
      apply: kopecksToUah(Math.min(unallocated, order.remainingKopecks)),
    }));
    const clientOrders = candidates
      .filter(
        (order) =>
          namesMatch(payment.counterName, order.clientName) &&
          !payment.matches.some((m) => m.orderId === order.id),
      )
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .slice(0, 30)
      .map((order) => ({
        orderId: order.id,
        number: order.number,
        clientName: order.clientName,
        orderDate: order.orderDate,
        remaining: kopecksToUah(order.remainingKopecks),
      }));
    return { payment, suggestions, named: named.get(payment.id) ?? [], clientOrders };
  });
}

/** Для кожного платежу з номерами в призначенні: що за замовлення й чи можна їх оплатити. */
async function describeNamedOrders(
  db: AnyPgDatabase,
  views: PaymentView[],
): Promise<Map<string, NamedOrder[]>> {
  const wanted = new Map(views.map((view) => [view.id, numbersOfPayment(view)]));
  const all = [...new Set([...wanted.values()].flat())];
  const result = new Map<string, NamedOrder[]>();
  if (all.length === 0) return result;
  const rows = await db
    .select({ order: orders, clientName: clients.name })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(and(inArray(orders.number, all), isNull(orders.deletedAt)));
  const paid = rows.length
    ? await db
        .select({
          orderId: paymentMatches.orderId,
          sum: sql<string>`sum(${paymentMatches.amount})`,
        })
        .from(paymentMatches)
        .where(
          inArray(
            paymentMatches.orderId,
            rows.map((row) => row.order.id),
          ),
        )
        .groupBy(paymentMatches.orderId)
    : [];
  const paidBy = new Map(paid.map((row) => [row.orderId, toKopecks(row.sum)]));
  for (const [paymentId, numbers] of wanted) {
    if (numbers.length === 0) continue;
    result.set(
      paymentId,
      numbers.map((number): NamedOrder => {
        const row = rows.find((item) => item.order.number === number);
        if (!row) {
          return {
            number,
            orderId: null,
            clientName: null,
            remaining: null,
            problem: "не знайдено.",
          };
        }
        const remaining = toKopecks(row.order.total) - (paidBy.get(row.order.id) ?? 0);
        const problem = orderPaymentProblem(row.order) ?? (remaining <= 0 ? "уже сплачене." : null);
        return {
          number,
          orderId: row.order.id,
          clientName: row.clientName,
          remaining: kopecksToUah(Math.max(remaining, 0)),
          problem,
        };
      }),
    );
  }
  return result;
}

/** Скільки платежів чекає в черзі (для підпису вкладки). */
export async function countQueue(db: AnyPgDatabase, actor: AppUser): Promise<number> {
  requirePermission(actor, "bank_payments", "read");
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.matchStatus, "unmatched"));
  return row?.n ?? 0;
}

/** Платежі, прив'язані до замовлення (блок «Оплата» в картці замовлення). */
export async function listOrderPayments(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<{ paymentId: string; occurredAt: Date; counterName: string | null; amount: string }[]> {
  requirePermission(actor, "bank_payments", "read");
  return db
    .select({
      paymentId: payments.id,
      occurredAt: payments.occurredAt,
      counterName: payments.counterName,
      amount: paymentMatches.amount,
    })
    .from(paymentMatches)
    .innerJoin(payments, eq(payments.id, paymentMatches.paymentId))
    .where(eq(paymentMatches.orderId, orderId))
    .orderBy(desc(payments.occurredAt));
}

// ---------------------------------------------------------------------------------------------
// Борги, повідомлення клієнтові, реквізити (D196, D197)
// ---------------------------------------------------------------------------------------------

export const DEBT_DAYS_KEY = "payment.debt_days";
export const REQUISITES_KEY = "payment.requisites";
export const DEFAULT_DEBT_DAYS = 1;

async function readSetting(db: AnyPgDatabase, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value;
}

/** Через скільки днів без оплати замовлення стає боргом (D196, за замовчуванням 1). */
export async function loadDebtDays(db: AnyPgDatabase): Promise<number> {
  const value = await readSetting(db, DEBT_DAYS_KEY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_DEBT_DAYS;
}

/** Реквізити для повідомлення клієнтові (текст у налаштуваннях бази, не в репозиторії). */
export async function getRequisites(db: AnyPgDatabase, actor: AppUser): Promise<string | null> {
  requirePermission(actor, "bank_payments", "read");
  const value = await readSetting(db, REQUISITES_KEY);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function setRequisites(
  db: AnyPgDatabase,
  actor: AppUser,
  text: string,
): Promise<void> {
  requirePermission(actor, "bank_payments", "write");
  const value = text.trim();
  if (value.length > 1000) throw new ValidationError("Реквізити: не більше 1000 символів.");
  await withActor(db, actor.id, async (tx) => {
    if (value === "") {
      await tx.delete(settings).where(eq(settings.key, REQUISITES_KEY));
      return;
    }
    const [existing] = await tx
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, REQUISITES_KEY));
    if (existing) await tx.update(settings).set({ value }).where(eq(settings.key, REQUISITES_KEY));
    else await tx.insert(settings).values({ key: REQUISITES_KEY, value });
  });
}

export type DebtOrder = {
  id: string;
  number: number | null;
  orderDate: string;
  remaining: string;
  /** Скільки днів минуло від відправки чи видачі. */
  days: number;
  deliveryMethod: "pickup" | "our_delivery" | "np" | "bus" | "other";
};

export type ClientDebt = {
  clientId: string;
  clientName: string;
  clientCode: string;
  total: string;
  orders: DebtOrder[];
};

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Борги (D196): відправлені замовлення з оплатою ФОП чи компанії без повної оплати, старші за
 * поріг днів від відправки (Нова Пошта) чи видачі (решта). Згруповані по клієнтах, найбільший борг першим.
 */
export async function listDebts(
  db: AnyPgDatabase,
  actor: AppUser,
  now: Date = new Date(),
): Promise<ClientDebt[]> {
  requirePermission(actor, "bank_payments", "read");
  const threshold = await loadDebtDays(db);
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      orderDate: orders.orderDate,
      total: orders.total,
      shippedAt: orders.shippedAt,
      deliveryMethod: orders.deliveryMethod,
      clientId: clients.id,
      clientName: clients.name,
      clientCode: clients.code,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.status, "shipped"),
        inArray(orders.paymentKind, ["fop", "company"]),
      ),
    );
  if (rows.length === 0) return [];
  const paid = await db
    .select({ orderId: paymentMatches.orderId, sum: sql<string>`sum(${paymentMatches.amount})` })
    .from(paymentMatches)
    .where(
      inArray(
        paymentMatches.orderId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(paymentMatches.orderId);
  const paidBy = new Map(paid.map((row) => [row.orderId, toKopecks(row.sum)]));
  const today = dayNumber(todayIso(now));

  const byClient = new Map<string, ClientDebt & { totalK: number }>();
  for (const row of rows) {
    const remaining = toKopecks(row.total) - (paidBy.get(row.id) ?? 0);
    if (remaining <= 0 || !row.shippedAt) continue;
    const days = Math.round(today - dayNumber(todayIso(row.shippedAt)));
    if (days < threshold) continue;
    const entry = byClient.get(row.clientId) ?? {
      clientId: row.clientId,
      clientName: row.clientName,
      clientCode: row.clientCode,
      total: "0.00",
      totalK: 0,
      orders: [],
    };
    entry.orders.push({
      id: row.id,
      number: row.number,
      orderDate: row.orderDate,
      remaining: kopecksToUah(remaining),
      days,
      deliveryMethod: row.deliveryMethod,
    });
    entry.totalK += remaining;
    byClient.set(row.clientId, entry);
  }
  return [...byClient.values()]
    .map(({ totalK, ...debt }) => ({
      ...debt,
      total: kopecksToUah(totalK),
      orders: debt.orders.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    }))
    .sort((a, b) => toKopecks(b.total) - toKopecks(a.total));
}
