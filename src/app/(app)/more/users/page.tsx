import type { Metadata } from "next";
import UsersPageContent from "@/components/usersPage/UsersPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listUsers } from "@/server/users";

export const metadata: Metadata = { title: "Користувачі" };

/** Список користувачів системи (лише власник: доступ закриває layout розділу). */
export default async function UsersPage() {
  const user = await requireUser();
  return <UsersPageContent users={await listUsers(getDb(), user)} />;
}
