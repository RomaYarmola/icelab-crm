/** Розділи застосунку, які показуємо в меню. Кожному відповідає адреса, підпис і значок. */
export type NavItemId =
  | "orders"
  | "clients"
  | "production"
  | "boxes"
  | "payments"
  | "cash"
  | "prices"
  | "audit"
  | "export"
  | "users"
  | "more";

export interface NavItem {
  id: NavItemId;
  /** Підпис у меню. */
  label: string;
  /** Заголовок сторінки в шапці, якщо він інший за підпис у меню (наприклад, «Ще» це «Профіль»). */
  title?: string;
  href: string;
}

export const NAV_ITEMS: Record<NavItemId, NavItem> = {
  orders: { id: "orders", label: "Замовлення", href: "/orders" },
  clients: { id: "clients", label: "Клієнти", href: "/clients" },
  production: { id: "production", label: "Виробництво", href: "/production" },
  boxes: { id: "boxes", label: "Бокси", href: "/boxes" },
  payments: { id: "payments", label: "Оплати", href: "/payments" },
  // Екрани всередині «Ще» («Готівка» для власника, менеджера, бухгалтера й старшого локації,
  // «Прайс» для власника, менеджера й бухгалтера, «Користувачі» для власника): у нижній панелі їх
  // немає, лише в меню «Ще».
  cash: { id: "cash", label: "Готівка", href: "/more/cash" },
  prices: { id: "prices", label: "Прайс", href: "/more/prices" },
  // Журнал змін: власник і бухгалтер (матриця `audit_log`), лише читання.
  audit: { id: "audit", label: "Журнал змін", href: "/more/audit" },
  // «Експорт усього»: уся база одним файлом Excel, лише власник (D94).
  export: { id: "export", label: "Експорт усього", href: "/more/export" },
  users: { id: "users", label: "Користувачі", href: "/more/users" },
  // У меню телефона пункт називається «Ще», а сама сторінка це профіль: у шапці так і пишемо.
  more: { id: "more", label: "Ще", title: "Профіль", href: "/more" },
};
