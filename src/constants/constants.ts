import type { orderStatus } from "@/db/schema/enums";

export const APP_NAME = "IceLab CRM";
export const APP_DESCRIPTION = "Облік клієнтів, замовлень, виробництва та оборотної тари IceLab";

/** Підпис у шапці, коли користувач бачить усі локації (власник, менеджер, бухгалтер). */
export const ALL_LOCATIONS_LABEL = "Усі локації";

/** Код статусу замовлення з бази (див. `order_status` у схемі). */
export type OrderStatus = (typeof orderStatus.enumValues)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Чернетка",
  confirmed: "Підтверджено",
  in_production: "У виробництві",
  packed: "Запаковано",
  shipped: "Відправлено",
  paid: "Оплачено",
  closed: "Закрито",
  cancelled: "Скасовано",
};

/** Мінімальна довжина пароля (Supabase Auth і форми). Спільна для сервера й екранів. */
export const MIN_PASSWORD_LENGTH = 10;
