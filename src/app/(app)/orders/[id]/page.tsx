import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  addOrderItemAction,
  changeOrderPriceAction,
  deleteDraftOrderAction,
  deleteOrderItemAction,
  transitionOrderAction,
  updateOrderItemAction,
} from "@/app/(app)/orders/actions";
import OrderCardContent from "@/components/ordersPage/OrderCardContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { canDeleteDraft, editPolicy, transitionOptions } from "@/server/order-rules";
import { getOrder } from "@/server/orders";
import { can } from "@/server/permissions";

export const metadata: Metadata = { title: "Замовлення" };

/**
 * Картка замовлення. Доступ до розділу закриває layout, права на дані перевіряє `getOrder`: чуже
 * замовлення для ролі з локацією це «не знайдено» (404), а не «заборонено».
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  // Некоректний ідентифікатор не доходить до бази: тип uuid кинув би помилку замість «не знайдено».
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  const [order, query] = await Promise.all([getOrder(getDb(), user, id), searchParams]);
  if (!order) notFound();

  const policy = editPolicy(order.status, user.role);
  const isOffice = user.role === "owner" || user.role === "manager";

  return (
    <OrderCardContent
      order={order}
      transitions={transitionOptions(order.status, user.role)}
      permissions={{
        canOverridePrice: can(user.role, "order_price_override", "write"),
        canDeleteDraft: canDeleteDraft(order.status, user.role),
        canEdit:
          policy.core !== "none" || policy.produce || policy.comment || policy.internalComment,
        canEditItems: isOffice && policy.core !== "none",
        itemsNeedNote: policy.core === "owner_note",
      }}
      notice={query.created ? "created" : undefined}
      actions={{
        transition: transitionOrderAction,
        changePrice: changeOrderPriceAction,
        remove: deleteDraftOrderAction,
        addItem: addOrderItemAction,
        updateItem: updateOrderItemAction,
        deleteItem: deleteOrderItemAction,
      }}
    />
  );
}
