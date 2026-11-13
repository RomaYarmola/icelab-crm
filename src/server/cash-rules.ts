import type { OrderStatus } from "@/constants/constants";
import { formatKopecks, parseDecimal } from "@/utils/orderMath";
import { formatMoney } from "@/utils/formatNumber";

/**
 * Правила готівки (D67, ТЗ 5.1 і 6.6): скільки прийнято й скільки лишилось, коли замовлення вважається
 * сплаченим, що можна записувати. Чисті функції без бази: усе рахуємо копійками (цілі числа), а не
 * дробами, щоб `0,1 + 0,2` не давало `0,30000000000000004`.
 */

/** Допуск за замовчуванням: `payment.amount_tolerance_uah` у налаштуваннях (ТЗ 4.1, 6.6). */
export const DEFAULT_CASH_TOLERANCE_UAH = 5;

/** Найбільша сума поля `numeric(10,2)`: 99 999 999,99 ₴. */
const MAX_KOPECKS = 9_999_999_999;

/** У яких статусах замовлення ще приймає готівку: підтверджене й не завершене. */
export const CASH_RECEIVING_STATUSES = [
  "confirmed",
  "in_production",
  "packed",
  "shipped",
] as const satisfies readonly OrderStatus[];

/** Гривні (рядок бази чи число) у копійки. */
export function toKopecks(value: string | number): number {
  return Math.round(parseDecimal(value) * 100);
}

export type CashAmount = { kopecks: number } | { error: string };

/**
 * Сума з поля форми («450», «450,5», «450.50»): число більше нуля, не більше двох знаків після коми.
 */
export function parseCashAmount(input: string | number): CashAmount {
  const text = typeof input === "number" ? String(input) : input.trim().replace(/\s/g, "");
  if (text === "") return { error: "Вкажіть суму." };
  const value = parseDecimal(text);
  if (!Number.isFinite(value)) return { error: "Сума має бути числом, наприклад 450 або 450,50." };
  if (value <= 0) return { error: "Сума має бути більшою за нуль." };
  if (!/^[0-9]+([.,][0-9]{1,2})?$/.test(text)) {
    return { error: "У сумі не більше двох знаків після коми." };
  }
  const kopecks = Math.round(value * 100);
  if (kopecks > MAX_KOPECKS) return { error: "Сума занадто велика." };
  return { kopecks };
}

export type CashEntryLike = { amount: string | number; reversed: boolean };

export type CashSummary = {
  /** Сума замовлення, копійки. */
  total: number;
  /** Прийнято (без сторнованих записів), копійки. */
  received: number;
  /** Скільки ще не прийнято, копійки (не менше нуля). */
  remaining: number;
  /** Прийнято не менше суми замовлення мінус допуск: замовлення вважається сплаченим. */
  paid: boolean;
  /** Щось прийнято, але ще не все: позначка «частково». */
  partial: boolean;
};

/**
 * Підсумок готівки по замовленню. Сторновані записи не рахуються (D69). Сплаченим замовлення
 * вважається, коли прийнято щось і не менше суми мінус допуск (ТЗ 6.6, за замовчуванням 5 грн).
 */
export function summarizeCash(
  total: string | number,
  entries: readonly CashEntryLike[],
  toleranceUah: number = DEFAULT_CASH_TOLERANCE_UAH,
): CashSummary {
  const totalKopecks = toKopecks(total);
  const received = entries.reduce(
    (sum, entry) => (entry.reversed ? sum : sum + toKopecks(entry.amount)),
    0,
  );
  const tolerance = Math.max(0, Math.round(toleranceUah * 100));
  const paid = received > 0 && received >= totalKopecks - tolerance;
  return {
    total: totalKopecks,
    received,
    remaining: Math.max(totalKopecks - received, 0),
    paid,
    partial: received > 0 && !paid,
  };
}

/**
 * Чи можна зараз приймати готівку по замовленню: лише з готівковою оплатою, підтверджене й ще не
 * оплачене. Повертає причину відмови або `null`.
 */
export function cashReceivingProblem(order: {
  status: OrderStatus;
  paymentKind: "cash" | "fop" | "company" | "unknown";
}): string | null {
  if (order.paymentKind !== "cash") {
    return "Це замовлення не з готівковою оплатою. Змініть спосіб оплати в замовленні.";
  }
  if (order.status === "draft") return "Спершу підтвердіть замовлення.";
  if (order.status === "cancelled") return "Замовлення скасоване: готівку по ньому не приймають.";
  if (order.status === "paid" || order.status === "closed") {
    return "Замовлення вже оплачене.";
  }
  return (CASH_RECEIVING_STATUSES as readonly string[]).includes(order.status)
    ? null
    : "У цьому статусі готівку не приймають.";
}

/**
 * Перевірка нової суми: не більше за залишок (переплату не приймаємо, D67; здачу не записуємо).
 * Повертає причину відмови або `null`.
 */
export function cashAmountProblem(amountKopecks: number, remainingKopecks: number): string | null {
  if (remainingKopecks <= 0) return "По цьому замовленню все вже прийнято.";
  if (amountKopecks > remainingKopecks) {
    return `Сума більша за залишок: лишилось ${formatMoney(remainingKopecks / 100)}.`;
  }
  return null;
}

/**
 * Чи можна зараз автоматично поставити «Оплачено» за готівкою (ТЗ 5.1): із «Відправлено», а для
 * самовивозу з оплатою на місці ще й із «Запаковано».
 */
export function canSettleByCash(
  status: OrderStatus,
  deliveryMethod: "pickup" | "our_delivery" | "np" | "bus" | "other",
): boolean {
  return status === "shipped" || (status === "packed" && deliveryMethod === "pickup");
}

/** Сума в гривнях рядком з двома знаками («450.00») для відповідей і форм. */
export const kopecksToUah = (kopecks: number): string => formatKopecks(kopecks);
