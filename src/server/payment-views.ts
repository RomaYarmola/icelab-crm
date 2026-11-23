import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { orders, paymentMatches, payments, clients } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import type { PaymentParams } from "@/utils/paymentParams";
import { toKopecks, kopecksToUah } from "./cash-rules";
import { loadCashTolerance } from "./cash-settlement";
import { type AppUser, requirePermission } from "./guards";
import { suggestOrders, type OrderSuggestion } from "./payment-rules";
import { loadCandidates } from "./payments";

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

export type QueueItem = { payment: PaymentView; suggestions: QueueSuggestion[] };

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
    return { payment, suggestions };
  });
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
