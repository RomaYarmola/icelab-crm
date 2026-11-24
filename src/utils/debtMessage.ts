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

/**
 * Повідомлення клієнтові з боргом і номерами замовлень (D197, ідея Романа): сума, перелік і готовий
 * текст призначення платежу. Реквізити, якщо задані, додаються окремим блоком. CRM нічого не
 * надсилає: менеджер копіює текст.
 */
export function buildDebtMessage(
  orders: readonly DebtMessageOrder[],
  requisites: string | null,
): string {
  const rows = orders.filter((order) => order.number !== null);
  if (rows.length === 0) return "";
  const total = rows.reduce((sum, order) => sum + Math.round(Number(order.remaining) * 100), 0);
  const numbers = rows.map((order) => order.number as number).sort((a, b) => a - b);
  const lines = [
    "Добрий день! Нагадуємо про оплату.",
    `До сплати: ${uah(total)}.`,
    "Замовлення:",
    ...rows
      .slice()
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map(
        (order) =>
          `№${order.number} від ${formatIsoDate(order.orderDate)}: ${uah(Math.round(Number(order.remaining) * 100))}`,
      ),
    "",
    `Будь ласка, у призначенні платежу вкажіть: «Оплата за замовлення №${joinNumbers(numbers)}».`,
  ];
  const details = requisites?.trim();
  if (details) lines.push("", "Реквізити для оплати:", details);
  return lines.join("\n");
}
