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
import { sellBoxAction } from "@/app/(app)/boxes/actions";
import {
  createShipmentAction,
  deleteShipmentAction,
  previewShipmentPriceAction,
} from "@/app/(app)/orders/shipment-actions";
import { getShipmentCard } from "@/server/np/shipments";
import { listOrderBoxes } from "@/server/boxes";
import { getOrder } from "@/server/orders";
import { can } from "@/server/permissions";
import { listEntityHistory } from "@/server/audit";
import { cashLinkFor } from "@/utils/cashLink";

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
  // Історія змін (D91): лише ролям, що бачать гроші; старший локації й виробництво її не отримують.
  const changeHistory = can(user.role, "order_money", "read")
    ? await listEntityHistory(getDb(), user, { kind: "order", id })
    : null;
  // Бокси замовлення (B9): ролі, що бачать бокси; продати бокс можуть власник і старший локації.
  const boxes = can(user.role, "box_debts_stock", "read")
    ? await listOrderBoxes(getDb(), id)
    : null;
  const canSellBox = user.role === "owner" || user.role === "location_lead";
  // Накладна Нової Пошти (B10): власник, менеджер і старший локації (своєї локації).
  const shipmentCard = await getShipmentCard(getDb(), user, id);
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
      cashHref={cashLinkFor(user.role, order)}
      changeHistory={changeHistory}
      boxes={boxes}
      sellBoxAction={canSellBox ? sellBoxAction : null}
      shipment={
        shipmentCard
          ? {
              card: shipmentCard,
              actions: {
                create: createShipmentAction,
                price: previewShipmentPriceAction,
                remove: deleteShipmentAction,
              },
            }
          : null
      }
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
