/**
 * Кілограми, ціни й суми замовлення (D53, D55). Усе рахуємо цілими числами (міліграми й копійки),
 * а не дробами: `30 × 1,1` у дробах дає 33,00000000000004, і `ceil` помилково повернув би 34.
 * Чисті функції без бази.
 */

/** Число з рядка бази («30.000», «75.00») або з поля форми з комою («30,5»). `NaN`, якщо не число. */
export function parseDecimal(value: string | number): number {
  if (typeof value === "number") return value;
  const text = value.trim().replace(",", ".");
  return /^-?[0-9]+(\.[0-9]+)?$/.test(text) ? Number(text) : Number.NaN;
}

const GRAMS = 1000;
const PERCENT_SCALE = 100;

/**
 * Скільки кг виготовити: `ceil(продано × (1 + p/100))` (D53). `percent` від 0 до 100, `kgSold` з
 * точністю до грама. Повертає ціле число кілограмів (округлення вгору).
 */
export function computeKgToProduce(kgSold: number, percent: number): number {
  if (!Number.isFinite(kgSold) || kgSold <= 0) return 0;
  const percentage = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
  const grams = Math.round(kgSold * GRAMS);
  const scaledPercent = Math.round(percentage * PERCENT_SCALE);
  const numerator = grams * (100 * PERCENT_SCALE + scaledPercent);
  const denominator = GRAMS * 100 * PERCENT_SCALE;
  const whole = Math.floor(numerator / denominator);
  return numerator % denominator === 0 ? whole : whole + 1;
}

/** Сума позиції: `round(кількість × ціна, 2)`, у гривнях рядком «2250.00» (як рахує база, D12). */
export function lineAmount(qty: number, pricePerUnit: number): string {
  const grams = Math.round(qty * GRAMS);
  const kopecks = Math.round(pricePerUnit * 100);
  return formatKopecks(Math.round((grams * kopecks) / GRAMS));
}

/** Сума замовлення: сума позицій (суми вже округлені до копійки). */
export function sumAmounts(amounts: (string | number)[]): string {
  const total = amounts.reduce<number>(
    (sum, amount) => sum + Math.round(parseDecimal(amount) * 100),
    0,
  );
  return formatKopecks(total);
}

/** Копійки в гривні з двома знаками: 225000 дає «2250.00». */
export function formatKopecks(kopecks: number): string {
  const sign = kopecks < 0 ? "-" : "";
  const abs = Math.abs(kopecks);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
