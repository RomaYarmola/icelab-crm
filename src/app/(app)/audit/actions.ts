"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { type AuditPage, listAuditEntries } from "@/server/audit";
import { AUDIT_SECTION_ORDER } from "@/server/audit-labels";
import { reportError } from "@/server/error-log";
import { ValidationError } from "@/server/errors";
import { UNEXPECTED_ERROR_MESSAGE } from "@/server/form-state";
import { ForbiddenError } from "@/server/guards";

export type LoadMoreAuditResult = { ok: true; page: AuditPage } | { ok: false; message: string };

const loadMoreSchema = z.object({
  section: z.enum(AUDIT_SECTION_ORDER as [string, ...string[]]).optional(),
  actorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  offset: z.number().int().min(0).max(100_000),
});

/** «Показати ще» у журналі: наступні записи з тими самими фільтрами. Права перевіряє `listAuditEntries`. */
export async function loadMoreAuditAction(
  query: z.input<typeof loadMoreSchema>,
): Promise<LoadMoreAuditResult> {
  const actor = await requireUser();
  const parsed = loadMoreSchema.safeParse(query);
  if (!parsed.success) return { ok: false, message: "Не вдалося завантажити записи." };
  const { offset, ...filters } = parsed.data;
  try {
    return {
      ok: true,
      page: await listAuditEntries(getDb(), actor, filters as never, { offset }),
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    await reportError({ source: "form_action", error });
    return { ok: false, message: UNEXPECTED_ERROR_MESSAGE };
  }
}
