/** Розділи застосунку, які показуємо в меню. Кожному відповідає адреса, підпис і значок. */
export type NavItemId = "orders" | "clients" | "production" | "boxes" | "payments" | "more";

export interface NavItem {
  id: NavItemId;
  label: string;
  href: string;
}

export const NAV_ITEMS: Record<NavItemId, NavItem> = {
  orders: { id: "orders", label: "Замовлення", href: "/orders" },
  clients: { id: "clients", label: "Клієнти", href: "/clients" },
  production: { id: "production", label: "Виробництво", href: "/production" },
  boxes: { id: "boxes", label: "Бокси", href: "/boxes" },
  payments: { id: "payments", label: "Оплати", href: "/payments" },
  more: { id: "more", label: "Ще", href: "/more" },
};
