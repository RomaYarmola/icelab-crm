import { eq } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { profiles, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { ValidationError } from "../errors";
import { type AppUser, requirePermission } from "../guards";

/**
 * Хто підтверджує чернетки заявок (D151, змінює D135 і D143). Список користувачів у налаштуванні
 * `intake.confirmers`. Поки список порожній, підтверджує будь-який менеджер чи власник, як і було.
 * Правило діє на кнопку в Telegram і на «Підтвердити» у вкладці «Чернетки»; відхиляти й
 * виправляти чернетки можуть усі, хто має до них доступ.
 */

export const CONFIRMERS_KEY = "intake.confirmers";

export const NOT_CONFIRMER_MESSAGE = "Підтверджувати заявки можуть лише призначені люди.";

export async function getConfirmerIds(db: AnyPgDatabase): Promise<string[]> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CONFIRMERS_KEY));
  return Array.isArray(row?.value)
    ? row.value.filter((id): id is string => typeof id === "string")
    : [];
}

/** Може користувач підтвердити чернетку: список порожній чи він у списку. */
export async function canConfirmDrafts(db: AnyPgDatabase, userId: string): Promise<boolean> {
  const ids = await getConfirmerIds(db);
  return ids.length === 0 || ids.includes(userId);
}

/** Додає чи прибирає підтверджувача. Лише власник. Порожній список знову означає «будь-хто». */
export async function setConfirmer(
  db: AnyPgDatabase,
  actor: AppUser,
  profileId: string,
  allowed: boolean,
): Promise<void> {
  requirePermission(actor, "migration_settings", "write");
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!profile || !profile.isActive || (profile.role !== "owner" && profile.role !== "manager")) {
    throw new ValidationError("Підтверджувати можуть менеджери й власник.");
  }
  const current = await getConfirmerIds(db);
  const next = allowed
    ? [...new Set([...current, profileId])]
    : current.filter((id) => id !== profileId);
  await withActor(db, actor.id, async (tx) => {
    const existing = await tx
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, CONFIRMERS_KEY));
    if (existing.length > 0) {
      await tx.update(settings).set({ value: next }).where(eq(settings.key, CONFIRMERS_KEY));
    } else {
      await tx.insert(settings).values({ key: CONFIRMERS_KEY, value: next });
    }
  });
}
