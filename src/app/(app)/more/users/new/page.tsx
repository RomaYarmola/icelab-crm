import type { Metadata } from "next";
import { createUserAction } from "@/app/(app)/more/users/actions";
import NewUserContent from "@/components/usersPage/NewUserContent";
import { getDb } from "@/db/client";
import { listActiveLocations } from "@/server/locations";

export const metadata: Metadata = { title: "Новий користувач" };

/** Створення користувача (лише власник: доступ закриває layout розділу). */
export default async function NewUserPage() {
  const locations = await listActiveLocations(getDb());
  return <NewUserContent locations={locations} action={createUserAction} />;
}
