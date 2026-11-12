/** Підписи значень клієнтів (екрани «Клієнти»). Значення беремо з переліків у схемі бази. */

export const LEGAL_TYPE_LABELS = {
  person: "Фізособа",
  fop: "ФОП",
  company: "ТОВ",
} as const;

export type LegalTypeValue = keyof typeof LEGAL_TYPE_LABELS;

export const ADDRESS_KIND_LABELS = {
  delivery: "Доставка",
  np_warehouse: "Склад Нової Пошти",
  np_address: "Адреса Нової Пошти",
  bus: "Автобус",
} as const;

export type AddressKindValue = keyof typeof ADDRESS_KIND_LABELS;

/** Перший пункт списку областей: клієнт без області отримує код з самих цифр (D42). */
export const NO_REGION_LABEL = "Без області (код з цифр)";

/** Вкладки картки клієнта. «Ціни» бачать лише ролі з правом на ціни клієнта. */
export const CLIENT_TABS = ["main", "contacts", "addresses", "prices"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export const CLIENT_TAB_LABELS: Record<ClientTab, string> = {
  main: "Основне",
  contacts: "Контакти",
  addresses: "Адреси",
  prices: "Ціни",
};
