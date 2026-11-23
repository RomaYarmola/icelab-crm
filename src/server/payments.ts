import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { clients, orders, paymentMatches, payments } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { z } from "zod";
import { CASH_RECEIVING_STATUSES, kopecksToUah, parseCashAmount, toKopecks } from "./cash-rules";
import { loadCashTolerance, settlePayment } from "./cash-settlement";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { closeIfDone } from "./order-status";
import {
  decideAutoMatch,
  isFullyAllocated,
  type MatchOrder,
  type MatchPayment,
} from "./payment-rules";

/**
 * Зіставлення платежів із замовленнями (B13, D188–D190). Автоматично (після кожної виписки) і вручну
 * (бухгалтер, власник). Платіж і замовлення блокуються в транзакції, тож один платіж не закриє два
 * замовлення, а замовлення не оплатять двічі. Коли суму покрито, замовлення «Відправлено» стає
 * «Оплачено» і далі закривається само (D51).
 */

const uuid = z.string().uuid("Некоректний ідентифікатор.");

type PaymentRow = typeof payments.$inferSelect;

/** Статуси замовлень, яким ще можна приймати оплату з банку (як для готівки). */
const OPEN_STATUSES = [...CASH_RECEIVING_STATUSES];
const BANK_KINDS = ["fop", "company"] as const;

async function allocatedKopecks(
  db: AnyPgDatabase,
  where: { paymentId?: string; orderId?: string },
): Promise<number> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${paymentMatches.amount}), 0)` })
    .from(paymentMatches)
    .where(
      where.paymentId
        ? eq(paymentMatches.paymentId, where.paymentId)
        : eq(paymentMatches.orderId, where.orderId!),
    );
  return toKopecks(row?.sum ?? 0);
}

/** Оновлює статус платежу за його зіставленнями: повністю розкладений стає «само» чи «вручну». */
async function refreshStatus(
  db: AnyPgDatabase,
  payment: Pick<PaymentRow, "id" | "amount" | "matchStatus">,
  toleranceKopecks: number,
): Promise<void> {
  if (payment.matchStatus === "ignored") return;
  const matches = await db
    .select({ amount: paymentMatches.amount, rule: paymentMatches.rule })
    .from(paymentMatches)
    .where(eq(paymentMatches.paymentId, payment.id));
  const allocated = matches.reduce((sum, match) => sum + toKopecks(match.amount), 0);
  const full =
    matches.length > 0 && isFullyAllocated(allocated, toKopecks(payment.amount), toleranceKopecks);
  const next = !full ? "unmatched" : matches.some((m) => m.rule === "manual") ? "manual" : "auto";
  if (next !== payment.matchStatus) {
    await db.update(payments).set({ matchStatus: next }).where(eq(payments.id, payment.id));
  }
}

/** Замовлення, які ще чекають оплату з банку, із залишком у копійках. */
async function loadCandidates(db: AnyPgDatabase): Promise<MatchOrder[]> {
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      clientId: orders.clientId,
      clientName: clients.name,
      total: orders.total,
      orderDate: orders.orderDate,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(
      and(
        isNull(orders.deletedAt),
        inArray(orders.status, OPEN_STATUSES),
        inArray(orders.paymentKind, [...BANK_KINDS]),
      ),
    );
  if (rows.length === 0) return [];
  const paid = await db
    .select({
      orderId: paymentMatches.orderId,
      sum: sql<string>`sum(${paymentMatches.amount})`,
    })
    .from(paymentMatches)
    .where(
      inArray(
        paymentMatches.orderId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(paymentMatches.orderId);
  const paidBy = new Map(paid.map((row) => [row.orderId, toKopecks(row.sum)]));
  return rows
    .map((row) => ({
      id: row.id,
      number: row.number,
      clientId: row.clientId,
      clientName: row.clientName,
      orderDate: row.orderDate,
      remainingKopecks: toKopecks(row.total) - (paidBy.get(row.id) ?? 0),
    }))
    .filter((order) => order.remainingKopecks > 0);
}

export type AutoMatchOutcome =
  | { matched: false }
  | { matched: true; orderId: string; rule: "comment_number" | "amount_date_name" };

/** Автозіставлення одного платежу. Нічого не робить, якщо правила не дають однозначної відповіді. */
export async function tryAutoMatch(
  db: AnyPgDatabase,
  paymentId: string,
): Promise<AutoMatchOutcome> {
  const tolerance = Math.round((await loadCashTolerance(db)) * 100);
  let closeOrderId: string | null = null;
  const outcome = await withActor(
    db,
    null,
    async (tx): Promise<AutoMatchOutcome> => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for("update");
      if (!payment || payment.matchStatus !== "unmatched") return { matched: false };
      if ((await allocatedKopecks(tx, { paymentId })) > 0) return { matched: false };

      const input: MatchPayment = {
        amountKopecks: toKopecks(payment.amount),
        occurredAt: payment.occurredAt,
        comment: payment.comment,
        description: payment.description,
        counterName: payment.counterName,
      };
      const decision = decideAutoMatch(input, await loadCandidates(tx), tolerance);
      if (!decision) return { matched: false };

      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, decision.orderId))
        .for("update");
      if (!order || order.deletedAt || !OPEN_STATUSES.includes(order.status as never)) {
        return { matched: false };
      }
      // Після блокування залишок могли змінити: перевіряємо ще раз.
      const remaining =
        toKopecks(order.total) - (await allocatedKopecks(tx, { orderId: order.id }));
      if (remaining < decision.appliedKopecks || decision.appliedKopecks <= 0)
        return { matched: false };

      await tx.insert(paymentMatches).values({
        paymentId: payment.id,
        orderId: order.id,
        amount: kopecksToUah(decision.appliedKopecks),
        matchedBy: null,
        rule: decision.rule,
      });
      await refreshStatus(tx, payment, tolerance);
      if (await settlePayment(tx, order)) closeOrderId = order.id;
      return { matched: true, orderId: order.id, rule: decision.rule };
    },
    { note: "Платіж зіставлено автоматично" },
  );
  if (closeOrderId) await closeIfDone(db, closeOrderId);
  return outcome;
}

/** Автозіставлення всіх нових платежів (після кожної виписки). Повертає, скільки зіставлено. */
export async function matchNewPayments(
  db: AnyPgDatabase,
): Promise<{ checked: number; matched: number }> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.matchStatus, "unmatched"));
  let matched = 0;
  for (const row of rows) {
    if ((await tryAutoMatch(db, row.id)).matched) matched += 1;
  }
  return { checked: rows.length, matched };
}

export type Allocation = { orderId: string; amount: string | number };

/**
 * Ручне зіставлення (бухгалтер, власник): розкласти платіж на одне чи кілька замовлень. Сума на
 * замовлення не більша за його залишок (з допуском), сума всіх не більша за незайняту частину платежу.
 * Замовлення має бути з оплатою ФОП чи компанії (D190).
 */
export async function matchPaymentManually(
  db: AnyPgDatabase,
  actor: AppUser,
  paymentId: string,
  allocations: readonly Allocation[],
): Promise<{ status: PaymentRow["matchStatus"]; remainingKopecks: number }> {
  requirePermission(actor, "bank_payments", "write");
  const id = parseInput(uuid, paymentId);
  if (allocations.length === 0) throw new ValidationError("Оберіть замовлення.");
  const parsed = allocations.map((item) => {
    const amount = parseCashAmount(item.amount);
    if ("error" in amount) throw new ValidationError(amount.error);
    return { orderId: parseInput(uuid, item.orderId), kopecks: amount.kopecks };
  });
  if (new Set(parsed.map((item) => item.orderId)).size !== parsed.length) {
    throw new ValidationError("Те саме замовлення вказано двічі.");
  }
  const tolerance = Math.round((await loadCashTolerance(db)) * 100);
  const toClose: string[] = [];

  const result = await withActor(
    db,
    actor.id,
    async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!payment) throw new ValidationError("Платіж не знайдено.");
      if (payment.matchStatus === "ignored") {
        throw new ValidationError("Платіж ігноровано. Спершу поверніть його в чергу.");
      }
      const amountK = toKopecks(payment.amount);
      const already = await allocatedKopecks(tx, { paymentId: id });
      const requested = parsed.reduce((sum, item) => sum + item.kopecks, 0);
      if (already + requested > amountK) {
        throw new ValidationError(
          `Сума більша за платіж: вільно ${kopecksToUah(amountK - already)} грн.`,
        );
      }
      for (const item of parsed) {
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, item.orderId))
          .for("update");
        if (!order || order.deletedAt) throw new ValidationError("Замовлення не знайдено.");
        if (!(BANK_KINDS as readonly string[]).includes(order.paymentKind)) {
          throw new ValidationError(
            order.paymentKind === "cash"
              ? "Замовлення з готівковою оплатою платежем не закриваємо."
              : "Спершу вкажіть у замовленні спосіб оплати (ФОП чи компанія).",
          );
        }
        if (!OPEN_STATUSES.includes(order.status as never)) {
          throw new ValidationError("У цьому статусі замовлення оплату з банку не приймає.");
        }
        const [duplicate] = await tx
          .select({ id: paymentMatches.id })
          .from(paymentMatches)
          .where(and(eq(paymentMatches.paymentId, id), eq(paymentMatches.orderId, order.id)));
        if (duplicate) throw new ValidationError("Платіж уже прив'язано до цього замовлення.");
        const remaining =
          toKopecks(order.total) - (await allocatedKopecks(tx, { orderId: order.id }));
        if (remaining <= 0) throw new ValidationError("По цьому замовленню все вже сплачено.");
        if (item.kopecks > remaining + tolerance) {
          throw new ValidationError(
            `Сума більша за залишок замовлення: лишилось ${kopecksToUah(remaining)} грн.`,
          );
        }
        await tx.insert(paymentMatches).values({
          paymentId: id,
          orderId: order.id,
          amount: kopecksToUah(item.kopecks),
          matchedBy: actor.id,
          rule: "manual",
        });
        if (await settlePayment(tx, order)) toClose.push(order.id);
      }
      await refreshStatus(tx, payment, tolerance);
      const [latest] = await tx
        .select({ status: payments.matchStatus })
        .from(payments)
        .where(eq(payments.id, id));
      return {
        status: latest!.status,
        remainingKopecks: amountK - already - requested,
      };
    },
    { note: "Платіж зіставлено вручну" },
  );
  for (const orderId of toClose) await closeIfDone(db, orderId);
  return result;
}

/** «Ігнорувати» платіж із причиною (не наш клієнт, внутрішній переказ). Лише для незіставленого. */
export async function ignorePayment(
  db: AnyPgDatabase,
  actor: AppUser,
  paymentId: string,
  reason: string,
): Promise<void> {
  requirePermission(actor, "bank_payments", "write");
  const id = parseInput(uuid, paymentId);
  const why = reason.trim();
  if (why === "") throw new ValidationError("Вкажіть причину.");
  if (why.length > 500) throw new ValidationError("Причина: не більше 500 символів.");
  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!payment) throw new ValidationError("Платіж не знайдено.");
      if (payment.matchStatus === "ignored") throw new ValidationError("Платіж уже ігноровано.");
      if ((await allocatedKopecks(tx, { paymentId: id })) > 0) {
        throw new ValidationError(
          "Платіж уже зіставлено із замовленням: ігнорувати його не можна.",
        );
      }
      await tx
        .update(payments)
        .set({ matchStatus: "ignored", ignoredReason: why })
        .where(eq(payments.id, id));
    },
    { note: why },
  );
}

/** Повертає ігнорований платіж у чергу (власник і бухгалтер). */
export async function restorePayment(
  db: AnyPgDatabase,
  actor: AppUser,
  paymentId: string,
): Promise<void> {
  requirePermission(actor, "bank_payments", "write");
  const id = parseInput(uuid, paymentId);
  await withActor(db, actor.id, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
    if (!payment || payment.matchStatus !== "ignored") {
      throw new ValidationError("Платіж не в списку ігнорованих.");
    }
    await tx
      .update(payments)
      .set({ matchStatus: "unmatched", ignoredReason: null })
      .where(eq(payments.id, id));
  });
}

/**
 * Скасовує всі зіставлення платежу (лише власник, з причиною). Якщо замовлення вже «Оплачено» чи
 * «Закрито», власник спершу повертає його на крок назад (як зі сторно готівки, D69).
 */
export async function unmatchPayment(
  db: AnyPgDatabase,
  actor: AppUser,
  paymentId: string,
  reason: string,
): Promise<void> {
  requirePermission(actor, "cash_reversal", "write");
  const id = parseInput(uuid, paymentId);
  const why = reason.trim();
  if (why === "") throw new ValidationError("Вкажіть причину.");
  if (why.length > 500) throw new ValidationError("Причина: не більше 500 символів.");
  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!payment) throw new ValidationError("Платіж не знайдено.");
      const matches = await tx
        .select()
        .from(paymentMatches)
        .where(eq(paymentMatches.paymentId, id));
      if (matches.length === 0) throw new ValidationError("Платіж ще не зіставлено.");
      const rows = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(
          inArray(
            orders.id,
            matches.map((m) => m.orderId),
          ),
        )
        .for("update");
      if (rows.some((row) => row.status === "paid" || row.status === "closed")) {
        throw new ValidationError(
          "Замовлення вже оплачене. Спершу поверніть його зі статусу «Оплачено» на крок назад.",
        );
      }
      await tx.delete(paymentMatches).where(eq(paymentMatches.paymentId, id));
      await tx.update(payments).set({ matchStatus: "unmatched" }).where(eq(payments.id, id));
    },
    { note: why },
  );
}
