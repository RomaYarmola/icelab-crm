/** Розділи застосунку, які показуємо в меню. Кожному відповідає адреса, підпис і значок. */
export type NavItemId =
  "orders" | "clients" | "production" | "boxes" | "payments" | "prices" | "users" | "more";

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
  // Екрани всередині «Ще» («Прайс» для власника, менеджера й бухгалтера, «Користувачі» для
  // власника): у нижній панелі їх немає, лише в меню «Ще».
  prices: { id: "prices", label: "Прайс", href: "/more/prices" },
  users: { id: "users", label: "Користувачі", href: "/more/users" },
  // У меню телефона пункт називається «Ще», а сама сторінка це профіль: у шапці так і пишемо.
  more: { id: "more", label: "Ще", title: "Профіль", href: "/more" },
};
