import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  clientAddressesAction,
  findDuplicateOrdersAction,
  orderPricingAction,
  repeatLastOrderAction,
  searchClientsForOrderAction,
  updateOrderAction,
} from "@/app/(app)/orders/actions";
import OrderFormContent from "@/components/ordersPage/OrderFormContent";
import { buildEditDefaults } from "@/components/ordersPage/orderFormDefaults";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { listActiveLocations } from "@/server/locations";
import { editPolicy } from "@/server/order-rules";
import { getOrder } from "@/server/orders";

export const metadata: Metadata = { title: "Змінити замовлення" };

/**
 * Зміна замовлення за правилами D58: що можна змінювати, залежить від статусу й ролі. Якщо роль
 * нічого змінювати не може (наприклад, замовлення закрите), повертаємо на картку.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  const db = getDb();
  const order = await getOrder(db, user, id);
  if (!order) notFound();

  const policy = editPolicy(order.status, user.role);
  if (policy.core === "none" && !policy.produce && !policy.comment && !policy.internalComment) {
    redirect(`/orders/${id}`);
  }

  const [options, locations] = await Promise.all([
    getClientFormOptions(db, user),
    listActiveLocations(db),
  ]);
  // Поточна ціна за кг для підказки: лише тим, хто бачить гроші (позиція «Лід» без ціни не прийшла б).
  const currentPrice =
    order.pricePerKgSnapshot ?? order.items.find((item) => item.kind === "ice")?.price ?? null;

  return (
    <OrderFormContent
      mode="edit"
      orderId={order.id}
      orderNumber={order.number}
      options={{
        locations,
        iceTypes: options.iceTypes,
        sources: options.sources,
        boxTypes: options.boxTypes,
      }}
      defaults={buildEditDefaults(order)}
      initialClient={{ id: order.clientId, code: order.clientCode, name: order.clientName }}
      policy={policy}
      currentPrice={currentPrice}
      canSeeInternal={order.internalComment !== undefined}
      actions={{
        submit: updateOrderAction,
        searchClients: searchClientsForOrderAction,
        clientAddresses: clientAddressesAction,
        pricing: orderPricingAction,
        findDuplicates: findDuplicateOrdersAction,
        repeatLast: repeatLastOrderAction,
      }}
    />
  );
}
