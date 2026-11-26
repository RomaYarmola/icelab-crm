import { formatIsoDate } from "./isoDate";

/** Гривні в тексті для клієнта: цілі без копійок, інакше завжди з двома знаками («1 000,50 ₴»). */
function uah(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  const text = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(kopecks / 100);
  return `${text}\u00a0₴`;
}

export type DebtMessageOrder = { number: number | null; orderDate: string; remaining: string };

/** Короткий запис номерів для призначення платежу: «1340, 1351 та 1360». */
export function joinNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} та ${numbers[numbers.length - 1]}`;
}

/** Найбільша довжина призначення платежу в ibanoplata.com (довідка сервісу). */
export const PURPOSE_MAX = 140;

/** Текст призначення платежу: «Оплата за замовлення №1340, 1351 та 1360». */
export function purposeFor(numbers: readonly number[]): string {
  return `Оплата за замовлення №${joinNumbers(numbers)}`;
}

/** Одне посилання на оплату: замовлення, сума в копійках і призначення не довше за ліміт сервісу. */
export type PaymentGroup = { numbers: number[]; kopecks: number; purpose: string };

/** Ключ посилання: інша сума чи інші номери означають, що потрібне нове посилання. */
export const linkKey = (group: Pick<PaymentGroup, "kopecks" | "purpose">) =>
  `${group.kopecks}|${group.purpose}`;

const kopecksOf = (order: DebtMessageOrder) => Math.round(Number(order.remaining) * 100);

/**
 * Ділить замовлення на групи так, щоб призначення кожної вміщалось у ліміт сервісу (140 символів).
 * Зазвичай група одна; довгий перелік стає кількома посиланнями. Замовлення за зростанням номерів.
 */
export function splitPaymentGroups(orders: readonly DebtMessageOrder[]): PaymentGroup[] {
  const rows = orders
    .filter((order) => order.number !== null)
    .slice()
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const groups: PaymentGroup[] = [];
  let current: DebtMessageOrder[] = [];
  const close = () => {
    if (current.length === 0) return;
    const numbers = current.map((order) => order.number as number);
    groups.push({
      numbers,
      kopecks: current.reduce((sum, order) => sum + kopecksOf(order), 0),
      purpose: purposeFor(numbers),
    });
    current = [];
  };
  for (const order of rows) {
    const next = [...current, order].map((item) => item.number as number);
    if (current.length > 0 && purposeFor(next).length > PURPOSE_MAX) close();
    current.push(order);
  }
  close();
  return groups;
}

/** Гривні для поля «Сума» в сервісі: «2250» чи «1000,50», без пробілів і символу валюти. */
export function amountField(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  return whole ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace(".", ",");
}

/** Посилання з сервісу приймаємо лише у вигляді адреси https; все інше ігноруємо. */
export function cleanPaymentLink(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return /^https:\/\/[^\s]+$/.test(text) ? text : null;
}

/**
 * Повідомлення клієнтові з боргом і номерами замовлень (D197, ідея Романа): сума, перелік і готовий
 * текст призначення платежу. Якщо менеджер створив у сервісі посилання на оплату, воно додається
 * (`links` за порядком груп, D202). Реквізити, якщо задані, йдуть окремим блоком. CRM нічого не
 * надсилає: менеджер копіює текст.
 */
export function buildDebtMessage(
  orders: readonly DebtMessageOrder[],
  requisites: string | null,
  links: readonly (string | undefined)[] = [],
): string {
  const groups = splitPaymentGroups(orders);
  if (groups.length === 0) return "";
  const rows = orders.filter((order) => order.number !== null);
  const total = rows.reduce((sum, order) => sum + kopecksOf(order), 0);
  const lines = [
    "Добрий день! Нагадуємо про оплату.",
    `До сплати: ${uah(total)}.`,
    "Замовлення:",
    ...rows
      .slice()
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map(
        (order) =>
          `№${order.number} від ${formatIsoDate(order.orderDate)}: ${uah(kopecksOf(order))}`,
      ),
    "",
  ];
  if (groups.length === 1) {
    const link = cleanPaymentLink(links[0]);
    lines.push(`Будь ласка, у призначенні платежу вкажіть: «${groups[0]!.purpose}».`);
    if (link) lines.push(`Оплатити за посиланням: ${link}`);
  } else {
    lines.push(`Оплату зручно зробити ${groups.length} платежами:`);
    groups.forEach((group, index) => {
      const link = cleanPaymentLink(links[index]);
      lines.push(
        `${index + 1}) ${uah(group.kopecks)}, призначення «${group.purpose}»${link ? `: ${link}` : "."}`,
      );
    });
  }
  const details = requisites?.trim();
  if (details) lines.push("", "Реквізити для оплати:", details);
  return lines.join("\n");
}
