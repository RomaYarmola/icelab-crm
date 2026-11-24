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
  /** Замовлення, які платіж закриває, і скільки з платежу йде на кожне, копійки. */
  allocations: { orderId: string; appliedKopecks: number }[];
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
 * Рішення автозіставлення (D188, D198). Правило 1 (основа): у призначенні названо одне чи кілька
 * замовлень, усі знайдені серед придатних, а сума платежу дорівнює сумі їхніх залишків (з допуском):
 * кожне замовлення оплачується на свій залишок. Правило 2 (допоміжне): номерів немає, платник
 * збігається з клієнтом, рівно одне замовлення цього клієнта в межах вікна має залишок, що дорівнює
 * сумі. Усе інше `null`: платіж іде в чергу, де його гасить людина.
 */
export function decideAutoMatch(
  payment: MatchPayment,
  orders: readonly MatchOrder[],
  toleranceKopecks: number,
): AutoMatch | null {
  const numbers = extractOrderNumbers(payment.comment, payment.description);
  if (numbers.length > 0) {
    // Номер, якого немає серед придатних замовлень, означає помилку клієнта: вирішує людина.
    const named: MatchOrder[] = [];
    for (const number of numbers) {
      const order = orders.find((candidate) => candidate.number === number);
      if (!order) return null;
      named.push(order);
    }
    const total = named.reduce((sum, order) => sum + order.remainingKopecks, 0);
    if (!amountFitsRemaining(payment.amountKopecks, total, toleranceKopecks)) return null;
    // Платіж трохи менший за суму залишків (у межах допуску): остання сума зменшується на різницю.
    let left = payment.amountKopecks;
    const allocations = named
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map((order) => {
        const appliedKopecks = Math.min(order.remainingKopecks, left);
        left -= appliedKopecks;
        return { orderId: order.id, appliedKopecks };
      })
      .filter((item) => item.appliedKopecks > 0);
    return allocations.length > 0 ? { allocations, rule: "comment_number" } : null;
  }

  const paidAt = payment.occurredAt.getTime();
  const fitting = orders.filter((order) => {
    if (!namesMatch(payment.counterName, order.clientName)) return false;
    const date = dayOf(order.orderDate);
    if (date < paidAt - MATCH_WINDOW_DAYS_BACK * DAY_MS) return false;
    if (date > paidAt + MATCH_WINDOW_DAYS_FORWARD * DAY_MS) return false;
    return amountFitsRemaining(payment.amountKopecks, order.remainingKopecks, toleranceKopecks);
  });
  if (fitting.length !== 1) return null;
  const only = fitting[0]!;
  return {
    allocations: [
      {
        orderId: only.id,
        appliedKopecks: Math.min(payment.amountKopecks, only.remainingKopecks),
      },
    ],
    rule: "amount_date_name",
  };
}

/** Платіж розкладено повністю: розкладено не менше за суму мінус допуск. */
export function isFullyAllocated(
  allocatedKopecks: number,
  amountKopecks: number,
  toleranceKopecks: number,
): boolean {
  return allocatedKopecks >= amountKopecks - toleranceKopecks;
}

export type OrderSuggestion = {
  order: MatchOrder;
  /** Чому запропоновано: номер у коментарі, платник, сума. */
  reasons: ("number" | "name" | "amount")[];
};

/**
 * Підказки для бухгалтера в черзі «Нерозпізнані» (ТЗ 6.10): замовлення з номером із коментаря, того
 * ж клієнта за іменем платника чи з сумою в допуску за вікно днів. Найпереконливіші першими.
 */
export function suggestOrders(
  payment: Omit<MatchPayment, "amountKopecks"> & { unallocatedKopecks: number },
  orders: readonly MatchOrder[],
  toleranceKopecks: number,
  limit = 5,
): OrderSuggestion[] {
  const numbers = new Set(extractOrderNumbers(payment.comment, payment.description));
  const paidAt = payment.occurredAt.getTime();
  const scored: (OrderSuggestion & { score: number })[] = [];
  for (const order of orders) {
    const reasons: OrderSuggestion["reasons"] = [];
    if (order.number !== null && numbers.has(order.number)) reasons.push("number");
    if (namesMatch(payment.counterName, order.clientName)) reasons.push("name");
    const date = dayOf(order.orderDate);
    const inWindow =
      date >= paidAt - MATCH_WINDOW_DAYS_BACK * DAY_MS &&
      date <= paidAt + MATCH_WINDOW_DAYS_FORWARD * DAY_MS;
    if (
      inWindow &&
      amountFitsRemaining(payment.unallocatedKopecks, order.remainingKopecks, toleranceKopecks)
    ) {
      reasons.push("amount");
    }
    if (reasons.length === 0) continue;
    const score =
      (reasons.includes("number") ? 4 : 0) +
      (reasons.includes("name") ? 2 : 0) +
      (reasons.includes("amount") ? 1 : 0);
    scored.push({ order, reasons, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.order.orderDate.localeCompare(b.order.orderDate))
    .slice(0, limit)
    .map(({ order, reasons }) => ({ order, reasons }));
}
