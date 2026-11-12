import { addDays, formatIsoDate, isIsoDate } from "@/utils/isoDate";
import { ValidationError } from "./errors";

/**
 * Правила зміни ціни (D45), спільні для цін клієнта і прайсу. Чисті функції без бази: що саме
 * зробити з чинною ціною, коли додають нову «від дати».
 */

/** Найбільша ціна за кг, яку приймаємо (захист від помилки в розряді). */
export const MAX_PRICE_PER_KG = 99999.99;

/**
 * Розбирає ціну за кг із форми: «60», «60.5», «60,50». Повертає рядок із двома знаками після
 * коми (так її віддає колонка `numeric(10,2)`). Нуль і від'ємні ціни не приймаємо.
 */
export function parsePricePerKg(input: string | number): string {
  const text = typeof input === "number" ? String(input) : input.trim().replace(/\s/g, "");
  if (!/^[0-9]+([.,][0-9]+)?$/.test(text)) {
    throw new ValidationError("Вкажіть ціну числом, наприклад 60 або 60,50.");
  }
  const normalized = text.replace(",", ".");
  const decimals = normalized.split(".")[1] ?? "";
  if (decimals.length > 2)
    throw new ValidationError("Ціна може мати не більше двох знаків після коми.");
  const value = Number(normalized);
  if (value <= 0) throw new ValidationError("Ціна має бути більшою за нуль.");
  if (value > MAX_PRICE_PER_KG)
    throw new ValidationError("Ціна надто велика. Перевірте, чи немає зайвої цифри.");
  return value.toFixed(2);
}

/** Перевіряє дату «від» (YYYY-MM-DD, існуючий день). */
export function parsePriceDate(input: string): string {
  const value = input.trim();
  if (!isIsoDate(value)) throw new ValidationError("Вкажіть дату, з якої діє ціна.");
  return value;
}

/** Чинна ціна без дати закінчення: остання в історії, яку міняємо. */
export type OpenPrice = {
  id: string;
  pricePerKg: string;
  validFrom: string;
};

export type PricePlan =
  /** Цін ще не було: додати першу. */
  | { kind: "insert"; validFrom: string }
  /** Та сама дата, що й початок чинної ціни: виправити ціну в тому самому рядку. */
  | { kind: "correct"; id: string }
  /** Закрити чинну днем перед новою датою і додати нову. */
  | { kind: "replace"; closeId: string; closeTo: string; validFrom: string };

/**
 * Що робити з історією цін, коли додають нову ціну від `validFrom`.
 * - цін немає: додаємо;
 * - дата не раніше початку чинної ціни: раніше не можна, бо історія не повинна накладатись;
 * - та сама дата: ціну виправляємо в тому самому рядку (закрити день у день не вийде);
 * - пізніша дата (зокрема майбутня): чинну закриваємо днем перед новою, нову додаємо.
 * Та сама ціна, що вже діє, помилка: нічого міняти не треба.
 */
export function planPriceChange(input: {
  open: OpenPrice | null;
  pricePerKg: string;
  validFrom: string;
}): PricePlan {
  const { open, pricePerKg, validFrom } = input;
  if (!open) return { kind: "insert", validFrom };

  if (validFrom < open.validFrom) {
    throw new ValidationError(
      `Нова дата не може бути раніше початку чинної ціни (${formatIsoDate(open.validFrom)}).`,
    );
  }
  if (Number(open.pricePerKg) === Number(pricePerKg)) {
    throw new ValidationError("Ця ціна вже діє. Щоб змінити, вкажіть іншу.");
  }
  if (validFrom === open.validFrom) return { kind: "correct", id: open.id };
  return { kind: "replace", closeId: open.id, closeTo: addDays(validFrom, -1), validFrom };
}
