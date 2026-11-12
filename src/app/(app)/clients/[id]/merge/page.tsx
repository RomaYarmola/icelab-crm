import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { mergeClientsAction } from "@/app/(app)/clients/actions";
import MergeClientsContent from "@/components/clientsPage/MergeClientsContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { previewMerge, type MergePreview } from "@/server/client-merge";
import { getClient, listClients } from "@/server/clients";
import { ForbiddenError } from "@/server/guards";
import { ValidationError } from "@/server/errors";

export const metadata: Metadata = { title: "Об'єднання клієнтів" };

const CANDIDATES_LIMIT = 10;

/** Об'єднання дублів. Лише власник: решту повертаємо на картку. */
export default async function MergeClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; duplicate?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  if (user.role !== "owner") redirect(`/clients/${id}`);

  const db = getDb();
  const { q = "", duplicate } = await searchParams;
  const main = await getClient(db, user, id);
  if (!main || main.isDeleted) notFound();

  let preview: MergePreview | null = null;
  let previewError: string | null = null;
  if (duplicate && z.uuid().safeParse(duplicate).success) {
    try {
      preview = await previewMerge(db, user, id, duplicate);
    } catch (error) {
      if (!(error instanceof ValidationError || error instanceof ForbiddenError)) throw error;
      previewError = error.message;
    }
  }

  const query = q.trim().slice(0, 100);
  const candidates =
    !preview && query !== ""
      ? (await listClients(db, user, { search: query, limit: CANDIDATES_LIMIT + 1 })).items
          .filter((item) => item.id !== id)
          .slice(0, CANDIDATES_LIMIT)
      : [];

  return (
    <MergeClientsContent
      main={{ id: main.id, code: main.code, name: main.name }}
      candidates={candidates}
      query={query}
      preview={preview}
      previewError={previewError}
      action={mergeClientsAction}
    />
  );
}
