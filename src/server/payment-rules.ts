/**
 * Правила зіставлення платежів із замовленнями (B13, D188–D190). Чисті функції без бази: усе, що
 * приймає рішення «це платіж за це замовлення», живе тут і покрите тестами на межах. Принцип: краще
 * пропустити платіж у чергу, ніж помилково закрити не те замовлення.
 */

/** За скільки днів до платежу (і скільки вперед) шукаємо замовлення для правила «сума й платник». */
export const MATCH_WINDOW_DAYS_BACK = 30;
export const MATCH_WINDOW_DAYS_FORWARD = 7;

const ORDER_NUMBERS =
  /(?:№|#|замовленн\p{L}*|заказ\p{L}*|зам\.|order)\s*[:#№-]?\s*(\d{1,7}(?:\s*(?:,|;|\/|\+|&|і|й|и|та|and)\s*#?№?\d{1,7})*)/giu;

/** Номери замовлень, названі в тексті з позначкою («№1340», «замовлення 1340»). Голі числа не беремо. */
export function extractOrderNumbers(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(ORDER_NUMBERS)) {
      for (const digits of match[1]!.match(/\d{1,7}/g) ?? []) found.add(Number(digits));
    }
  }
  return [...found];
}

const LEGAL_FORMS = /(?<!\p{L})(фоп|тов|пп|пат|ат|прат|тзов|пе|сфг|фг|ооо|ип|llc|ltd)(?!\p{L})/giu;

/** Назва для порівняння: без форми власності, лапок, розділових знаків і регістру. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/^від\s*:\s*/u, "")
    .replace(/[«»"'`’ʼ.,;:()\-–—_/\\]/gu, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Платник збігається з клієнтом: рівні після нормалізації або одна назва повністю входить в іншу. */
export function namesMatch(payer: string | null | undefined, client: string): boolean {
  const a = normalizeName(payer);
  const b = normalizeName(client);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export type MatchPayment = {
  amountKopecks: number;
  occurredAt: Date;
  comment: string | null;
  description: string | null;
  counterName: string | null;
};

export type MatchOrder = {
  id: string;
  number: number | null;
  clientId: string;
  clientName: string;
  /** Скільки ще не оплачено, копійки (> 0). */
  remainingKopecks: number;
  orderDate: string;
};

export type AutoMatch = {
  orderId: string;
  /** Скільки з платежу йде на замовлення, копійки. */
  appliedKopecks: number;
  rule: "comment_number" | "amount_date_name";
};

/** Сума платежу дорівнює залишку замовлення з допуском (переплату понад допуск автоматично не беремо). */
export function amountFitsRemaining(
  amountKopecks: number,
  remainingKopecks: number,
  toleranceKopecks: number,
): boolean {
  return Math.abs(amountKopecks - remainingKopecks) <= toleranceKopecks;
}

const DAY_MS = 86_400_000;

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * Рішення автозіставлення (D188). Правило 1: у коментарі один номер замовлення, замовлення знайдено,
 * сума збігається із залишком. Правило 2: номера немає, платник збігається з клієнтом, рівно одне
 * замовлення цього клієнта в межах вікна має залишок, що дорівнює сумі. Інакше `null` (черга).
 */
export function decideAutoMatch(
  payment: MatchPayment,
  orders: readonly MatchOrder[],
  toleranceKopecks: number,
): AutoMatch | null {
  const apply = (order: MatchOrder, rule: AutoMatch["rule"]): AutoMatch => ({
    orderId: order.id,
    appliedKopecks: Math.min(payment.amountKopecks, order.remainingKopecks),
    rule,
  });

  const numbers = extractOrderNumbers(payment.comment, payment.description);
  if (numbers.length > 0) {
    // Кілька номерів чи невідомий номер: це платіж за кілька замовлень або чужий, вирішує людина.
    if (numbers.length !== 1) return null;
    const order = orders.find((candidate) => candidate.number === numbers[0]);
    if (!order) return null;
    return amountFitsRemaining(payment.amountKopecks, order.remainingKopecks, toleranceKopecks)
      ? apply(order, "comment_number")
      : null;
  }

  const paidAt = payment.occurredAt.getTime();
  const fitting = orders.filter((order) => {
    if (!namesMatch(payment.counterName, order.clientName)) return false;
    const date = dayOf(order.orderDate);
    if (date < paidAt - MATCH_WINDOW_DAYS_BACK * DAY_MS) return false;
    if (date > paidAt + MATCH_WINDOW_DAYS_FORWARD * DAY_MS) return false;
    return amountFitsRemaining(payment.amountKopecks, order.remainingKopecks, toleranceKopecks);
  });
  return fitting.length === 1 ? apply(fitting[0]!, "amount_date_name") : null;
}

/** Платіж розкладено повністю: розкладено не менше за суму мінус допуск. */
export function isFullyAllocated(
  allocatedKopecks: number,
  amountKopecks: number,
  toleranceKopecks: number,
): boolean {
  return allocatedKopecks >= amountKopecks - toleranceKopecks;
}
