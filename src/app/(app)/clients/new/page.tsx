import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  createClientAction,
  findSimilarClientsAction,
  previewClientCodeAction,
} from "@/app/(app)/clients/actions";
import NewClientContent from "@/components/clientsPage/NewClientContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getClientFormOptions } from "@/server/client-options";
import { can } from "@/server/permissions";

export const metadata: Metadata = { title: "Новий клієнт" };

/** Створення клієнта. Лише ті, хто може змінювати клієнтів; решту повертаємо до списку. */
export default async function NewClientPage() {
  const user = await requireUser();
  if (!can(user.role, "clients", "write")) redirect("/clients");

  const options = await getClientFormOptions(getDb(), user);
  return (
    <NewClientContent
      options={options}
      defaultManagerId={options.managers.some((manager) => manager.id === user.id) ? user.id : ""}
      actions={{
        create: createClientAction,
        previewCode: previewClientCodeAction,
        findSimilar: findSimilarClientsAction,
      }}
    />
  );
}
