/** Тексти боргів по боксах: відмінок слова «бокс» і нагадування клієнтові (D113). Без бази. */

/** Текст нагадування клієнтові: менеджер копіює його й надсилає сам (D113). */
export function debtReminderText(row: {
  total: number;
  boxTypeName: string;
  oldestDay: string | null;
}) {
  const since = row.oldestDay ? `, видані ${formatDay(row.oldestDay)}` : "";
  return (
    `Добрий день! За вами числиться ${row.total} ${boxWord(row.total)} «${row.boxTypeName}»${since}. ` +
    "Будь ласка, поверніть їх при найближчій можливості або напишіть, коли зручно. Дякуємо! IceLab"
  );
}

const formatDay = (iso: string) => iso.split("-").reverse().join(".");

/** «1 бокс», «2 бокси», «5 боксів». */
export function boxWord(count: number): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "боксів";
  if (last === 1) return "бокс";
  if (last >= 2 && last <= 4) return "бокси";
  return "боксів";
}
