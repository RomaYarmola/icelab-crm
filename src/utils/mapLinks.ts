/**
 * Посилання для телефона на картці цеху (D118): дзвінок отримувачу й Google Maps. Звичайні
 * посилання без ключів і реєстрації: на телефоні відкривається застосунок «Телефон» чи «Карти».
 */

/** `tel:` для номера в форматі E.164 (`+380501234567`). Некоректний номер дає `null`. */
export function telHref(phone: string | null | undefined): string | null {
  const value = (phone ?? "").trim();
  return /^\+[0-9]{8,15}$/.test(value) ? `tel:${value}` : null;
}

/** Відкрити місце на карті. */
export function mapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Одразу прокласти маршрут до місця від поточного положення. */
export function mapRouteUrl(query: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}
