import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  addAddressAction,
  addContactAction,
  assignRegionAction,
  changeClientPriceAction,
  deleteAddressAction,
  deleteClientAction,
  deleteContactAction,
  restoreClientAction,
  updateAddressAction,
  updateClientAction,
  updateContactAction,
} from "@/app/(app)/clients/actions";
import ClientCardContent from "@/components/clientsPage/ClientCardContent";
import { CLIENT_TABS, type ClientTab } from "@/constants/clients";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { getClient } from "@/server/clients";
import { can } from "@/server/permissions";
import { listDefaultPrices } from "@/server/prices";
import { todayIso } from "@/utils/isoDate";

export const metadata: Metadata = { title: "Клієнт" };

const isTab = (value: string | undefined): value is ClientTab =>
  CLIENT_TABS.some((tab) => tab === value);

/** Картка клієнта. Вкладка в адресі (`?tab=`), доступ до розділу закриває layout, права на дані `getClient`. */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string; merged?: string }>;
}) {
  const { id } = await params;
  // Некоректний ідентифікатор не доходить до бази: тип uuid кинув би помилку замість «не знайдено».
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  const db = getDb();
  const [client, options, query] = await Promise.all([
    getClient(db, user, id),
    getClientFormOptions(db, user),
    searchParams,
  ]);
  if (!client) notFound();

  // Прайс для порівняння потрібен лише тим, хто бачить ціни (вони ж мають право на прайс).
  const defaultPrices =
    client.prices !== undefined && can(user.role, "default_prices", "read")
      ? await listDefaultPrices(db, user)
      : null;

  return (
    <ClientCardContent
      client={client}
      tab={isTab(query.tab) ? query.tab : "main"}
      options={options}
      defaultPrices={defaultPrices}
      today={todayIso()}
      notice={query.created ? "created" : query.merged ? "merged" : undefined}
      permissions={{
        canWrite: can(user.role, "clients", "write"),
        canEditPrices: can(user.role, "client_prices", "write"),
        isOwner: user.role === "owner",
      }}
      actions={{
        update: updateClientAction,
        assignRegion: assignRegionAction,
        remove: deleteClientAction,
        restore: restoreClientAction,
        addContact: addContactAction,
        updateContact: updateContactAction,
        deleteContact: deleteContactAction,
        addAddress: addAddressAction,
        updateAddress: updateAddressAction,
        deleteAddress: deleteAddressAction,
        changePrice: changeClientPriceAction,
      }}
    />
  );
}
