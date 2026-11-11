/**
 * Дати й час за стандартом uk-UA у часовому поясі Києва (вимога ТЗ: на сервері й на клієнті один
 * пояс, інакше серверний рендер і браузер покажуть різний час).
 */
export const APP_LOCALE = "uk-UA";
export const APP_TIME_ZONE = "Europe/Kyiv";

type DateInput = Date | string | number;

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value));

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const longDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "long",
});

/** 10.11.2026 */
export const formatDate = (value: DateInput): string => dateFormatter.format(toDate(value));

/** 14:05 */
export const formatTime = (value: DateInput): string => timeFormatter.format(toDate(value));

/** 10.11.2026, 14:05 */
export const formatDateTime = (value: DateInput): string =>
  `${formatDate(value)}, ${formatTime(value)}`;

/** 10 листопада */
export const formatLongDate = (value: DateInput): string => longDateFormatter.format(toDate(value));
