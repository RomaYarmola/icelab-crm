import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { updateUserAction } from "@/app/(app)/more/users/actions";
import UserDetailContent from "@/components/usersPage/UserDetailContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listActiveLocations } from "@/server/locations";
import { getUser } from "@/server/users";

export const metadata: Metadata = { title: "Користувач" };

/** Екран користувача (лише власник: доступ закриває layout розділу). */
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  // Некоректний ідентифікатор не доходить до бази: тип uuid кинув би помилку замість «не знайдено».
  if (!z.uuid().safeParse(id).success) notFound();

  const actor = await requireUser();
  const db = getDb();
  const [user, locations, { created }] = await Promise.all([
    getUser(db, actor, id),
    listActiveLocations(db),
    searchParams,
  ]);
  if (!user) notFound();

  return (
    <UserDetailContent
      user={user}
      locations={locations}
      isSelf={user.id === actor.id}
      isJustCreated={Boolean(created)}
      updateAction={updateUserAction}
    />
  );
}
