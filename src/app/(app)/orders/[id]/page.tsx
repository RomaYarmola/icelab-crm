import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  changeOrderPriceAction,
  deleteDraftOrderAction,
  transitionOrderAction,
} from "@/app/(app)/orders/actions";
import OrderCardContent from "@/components/ordersPage/OrderCardContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { canDeleteDraft, transitionOptions } from "@/server/order-rules";
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

  return (
    <OrderCardContent
      order={order}
      transitions={transitionOptions(order.status, user.role)}
      permissions={{
        canOverridePrice: can(user.role, "order_price_override", "write"),
        canDeleteDraft: canDeleteDraft(order.status, user.role),
      }}
      notice={query.created ? "created" : undefined}
      actions={{
        transition: transitionOrderAction,
        changePrice: changeOrderPriceAction,
        remove: deleteDraftOrderAction,
      }}
    />
  );
}
