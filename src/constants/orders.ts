import { ORDER_STATUS_LABELS, type OrderStatus } from "./constants";

/** Підписи значень замовлень (екрани «Замовлення»). Значення беремо з переліків у схемі бази. */

export const DELIVERY_METHOD_LABELS = {
  pickup: "Самовивіз",
  our_delivery: "Наша доставка",
  np: "Нова Пошта",
  bus: "Автобус",
  other: "Інше",
} as const;

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
