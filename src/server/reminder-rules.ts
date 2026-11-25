/** Правила нагадувань (B14, ТЗ 7.7, D209): чисті функції без бази. */

export const DEFAULT_BOX_REMINDER_DAYS = 14;
/** Скільки днів повернення боксу має пролежати на пошті, щоб нагадати (B17, D226). */
export const DEFAULT_RETURN_REMINDER_DAYS = 3;
/** Про того самого клієнта чи його бокси нагадуємо не частіше ніж раз на стільки днів. */
export const REPEAT_DAYS = 7;
export const DEFAULT_REMINDERS_TIME = "09:00";
/** Скільки рядків уміщає одне повідомлення в Telegram. */
export const MESSAGE_LINES = 20;

export type ReminderLine =
  | { kind: "client_inactive"; clientName: string; days: number }
  | { kind: "box_overdue"; clientName: string; count: number; days: number }
  | { kind: "payment_unmatched"; count: number }
  | {
      kind: "box_return_waiting";
      /** Скільки посилок чекає довше порогу, по містах. */
      places: { name: string; count: number }[];
      /** Скільки днів чекає найдавніша. */
      days: number;
    };

export function describeReminder(line: ReminderLine): string {
  switch (line.kind) {
    case "client_inactive":
      return `«${line.clientName}» не замовляє ${line.days} дн.`;
    case "box_overdue":
      return `Бокси в «${line.clientName}»: ${line.count} шт, найдовше ${line.days} дн.`;
    case "payment_unmatched":
      return `Нерозпізнаних платежів: ${line.count}`;
    case "box_return_waiting": {
      const total = line.places.reduce((sum, place) => sum + place.count, 0);
      const detail =
        line.places.length > 1
          ? ` (${line.places.map((place) => `${place.name} ${place.count}`).join(", ")})`
          : "";
      return `Бокси чекають на пошті: ${total} посил.${detail}, найдовше ${line.days} дн.`;
    }
  }
}

/** Текст ранкового повідомлення в Telegram: список, не довший за `MESSAGE_LINES` рядків. */
export function formatReminderMessage(lines: readonly string[], link?: string): string {
  const shown = lines.slice(0, MESSAGE_LINES);
  const rest = lines.length - shown.length;
  const text = ["Нагадування на сьогодні:", ...shown.map((line) => `• ${line}`)];
  if (rest > 0) text.push(`…і ще ${rest}. Увесь список у CRM.`);
  if (link) text.push("", link);
  return text.join("\n");
}
