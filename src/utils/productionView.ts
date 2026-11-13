import { APP_TIME_ZONE } from "./formatDate";
import { addDays, formatIsoDate } from "./isoDate";

/** Підписи для картки цеху (D63). Чисті функції без React. */

/**
 * Тара на картці: «Наш довгий 46 л × 2», для чужої тари «Бокс клієнта × 2», для проданої з
 * приміткою. Без тари (0 штук) нічого не показуємо.
 */
export function describeBoxes(input: {
  boxTypeName: string | null;
  boxCount: number;
  boxOwnership: "ours" | "client" | "sold";
}): string | null {
  if (input.boxCount <= 0) return null;
  const count = `× ${input.boxCount}`;
  if (input.boxOwnership === "client") return `Бокс клієнта ${count}`;
  const name = input.boxTypeName ?? "Тара";
  return input.boxOwnership === "sold" ? `${name} ${count}, продаємо` : `${name} ${count}`;
}

const clockFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** Час за київським часом у вигляді «14:05» (шведський формат стабільний на сервері й у браузері). */
export function formatClock(value: Date | string): string {
  return clockFormatter.format(typeof value === "string" ? new Date(value) : value);
}

/** День для заголовка: «Сьогодні», «Завтра», «Вчора» або дата «14.11.2026». */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Сьогодні";
  if (date === addDays(today, 1)) return "Завтра";
  if (date === addDays(today, -1)) return "Вчора";
  return formatIsoDate(date);
}

/** Скільки кг у тексті: ціле без «,000», дробове з комою (30 → «30», 22.5 → «22,5»). */
export function formatKgPlain(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}
