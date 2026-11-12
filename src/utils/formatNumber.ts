import { APP_LOCALE } from "./formatDate";

/** Числа, кілограми і гроші за стандартом uk-UA: пробіл між тисячами, кома в дробах. */

const numberFormatter = new Intl.NumberFormat(APP_LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const moneyFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: "UAH",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 1 250,5 */
export const formatNumber = (value: number): string => numberFormatter.format(value);

/** 30 кг, 12,5 кг */
export const formatKg = (value: number): string => `${formatNumber(value)} кг`;

/** 2 250 ₴, 99,90 ₴ */
export const formatMoney = (value: number): string => moneyFormatter.format(value);

/** 75 ₴/кг. Ціну з бази (рядок «75.00») приймаємо як є. */
export const formatPricePerKg = (value: string | number): string =>
  `${formatMoney(Number(value))}/кг`;
