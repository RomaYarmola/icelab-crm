import { ORDER_STATUS_LABELS, type OrderStatus } from "./constants";

/** Підписи значень замовлень (екрани «Замовлення»). Значення беремо з переліків у схемі бази. */

export const DELIVERY_METHOD_LABELS = {
  pickup: "Самовивіз",
  our_delivery: "Власна доставка",
  np: "Нова Пошта",
  bus: "Автобус",
  other: "Інше",
} as const;

/**
 * Способи доставки, які можна обрати в формі замовлення (Роман, 20.11.2026): самовивіз, Нова Пошта
 * і власна адресна доставка. «Автобус» та «Інше» лишаються в базі для старих замовлень.
 */
/** Нова Пошта: два варіанти відправки (Роман, 20.11.2026). */
export const NP_DELIVERY_KIND_LABELS = {
  warehouse: "На відділення або поштомат",
  courier: "Адресна, кур'єром",
} as const;

export type NpDeliveryKindValue = keyof typeof NP_DELIVERY_KIND_LABELS;

export const SELECTABLE_DELIVERY_METHODS = ["pickup", "np", "our_delivery"] as const;

/**
 * Чи можна брати з клієнта платну доставку (D235): Новою Поштою клієнт платить перевізнику сам, а
 * при самовивозі доставки немає.
 */
export const canChargeDelivery = (method: string) => method !== "np" && method !== "pickup";

export type DeliveryMethodValue = keyof typeof DELIVERY_METHOD_LABELS;

export const BOX_OWNERSHIP_LABELS = {
  ours: "Наша тара",
  client: "Тара клієнта",
  sold: "Продана клієнту",
} as const;

export const PAYMENT_KIND_LABELS = {
  cash: "Готівка",
  fop: "ФОП",
  company: "ТОВ",
  unknown: "Не вказано",
} as const;

/** Статуси в порядку ланцюжка (D51) для списку вибору й підписів. */
export const ORDER_STATUS_ORDER: OrderStatus[] = [
  "draft",
  "confirmed",
  "in_production",
  "packed",
  "shipped",
  "paid",
  "closed",
  "cancelled",
];

export { ORDER_STATUS_LABELS };

/** Напис на кнопці кроку вперед: до якого статусу переводить. */
export const FORWARD_BUTTON_LABELS: Partial<Record<OrderStatus, string>> = {
  confirmed: "Підтвердити замовлення",
  in_production: "Передати у виробництво",
  packed: "Позначити запакованим",
  shipped: "Позначити відправленим",
  paid: "Позначити оплаченим",
};

export const BACK_BUTTON_LABEL = "Повернути на крок назад";
export const CANCEL_BUTTON_LABEL = "Скасувати замовлення";

/** Підпис поля примітки для переходу, що її потребує. */
export const NOTE_LABELS = {
  cancel: "Причина скасування",
  back: "Чому повертаєте на крок назад",
  forward: "Примітка до оплати",
} as const;
