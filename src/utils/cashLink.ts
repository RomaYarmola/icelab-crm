import { can, type UserRole } from "@/server/permissions";

/**
 * Посилання «Готівка» з картки замовлення на екран готівки цього дня (ТЗ 6.3, D67): лише для ролей,
 * що читають готівку, і лише по підтверджених замовленнях з готівковою оплатою. Старший локації
 * замовлення чужої локації не відкриє взагалі, тож зайвої перевірки тут немає.
 */
export function cashLinkFor(
  role: UserRole,
  order: {
    id: string;
    orderDate: string;
    status: string;
    paymentKind?: "cash" | "fop" | "company" | "unknown";
  },
): string | null {
  if (!can(role, "order_cash", "read")) return null;
  if (order.paymentKind !== "cash") return null;
  if (order.status === "draft" || order.status === "cancelled") return null;
  return `/more/cash?date=${order.orderDate}#order-${order.id}`;
}
