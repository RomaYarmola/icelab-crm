import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clientAddressesAction,
  createOrderAction,
  findDuplicateOrdersAction,
  orderPricingAction,
  repeatLastOrderAction,
  searchClientsForOrderAction,
} from "@/app/(app)/orders/actions";
import OrderFormContent from "@/components/ordersPage/OrderFormContent";
import { buildCreateDefaults } from "@/components/ordersPage/orderFormDefaults";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { getClient } from "@/server/clients";
import { getLocationFilter } from "@/server/location-filter";
import { listActiveLocations } from "@/server/locations";
import { can } from "@/server/permissions";
import { isIsoDate, todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Нове замовлення" };

/**
 * Створення замовлення. Лише власник і менеджер: решту повертаємо до списку. Клієнта можна вибрати
 * наперед (`?client=`), дату теж (`?date=`). Локація за замовчуванням: вибрана в шапці, інакше перша.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; date?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "orders", "write") || (user.role !== "owner" && user.role !== "manager")) {
    redirect("/orders");
  }

  const db = getDb();
  const [query, options, locations, locationFilter] = await Promise.all([
    searchParams,
    getClientFormOptions(db, user),
    listActiveLocations(db),
    getLocationFilter(),
  ]);

  const clientId = z.uuid().safeParse(query.client).success ? query.client! : null;
  const preselected = clientId ? await getClient(db, user, clientId) : null;
  const today = todayIso();
  const locationId = locationFilter.selectedId ?? user.locationId ?? locations[0]?.id ?? "";

  return (
    <OrderFormContent
      mode="create"
      options={{
        locations,
        iceTypes: options.iceTypes,
        sources: options.sources,
        boxTypes: options.boxTypes,
      }}
      defaults={buildCreateDefaults({
        today: query.date && isIsoDate(query.date) ? query.date : today,
        locationId,
      })}
      initialClient={
        preselected && !preselected.isDeleted
          ? { id: preselected.id, code: preselected.code, name: preselected.name }
          : null
      }
      canSeeInternal
      actions={{
        submit: createOrderAction,
        searchClients: searchClientsForOrderAction,
        clientAddresses: clientAddressesAction,
        pricing: orderPricingAction,
        findDuplicates: findDuplicateOrdersAction,
        repeatLast: repeatLastOrderAction,
      }}
    />
  );
}
