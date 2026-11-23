import { eq } from "drizzle-orm";
import { telegramSessions } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Діалоги бота (B12, ТЗ 8.2, D183): що бот пам'ятає між повідомленнями користувача. Один діалог на
 * Telegram-користувача; новий замінює старий; застарілий (понад добу) вважаємо відсутнім.
 */

export const SESSION_TTL_MS = 24 * 3_600_000;

export type BotSession = { state: string; payload: Record<string, unknown>; updatedAt: Date };

export async function setSession(
  db: AnyPgDatabase,
  telegramUserId: number,
  state: string,
  payload: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(telegramSessions)
    .values({ telegramUserId, state, payload, updatedAt: now })
    .onConflictDoUpdate({
      target: telegramSessions.telegramUserId,
      set: { state, payload, updatedAt: now },
    });
}

export async function getSession(
  db: AnyPgDatabase,
  telegramUserId: number,
  now: Date = new Date(),
): Promise<BotSession | null> {
  const [row] = await db
    .select()
    .from(telegramSessions)
    .where(eq(telegramSessions.telegramUserId, telegramUserId));
  if (!row || now.getTime() - row.updatedAt.getTime() > SESSION_TTL_MS) return null;
  return {
    state: row.state,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    updatedAt: row.updatedAt,
  };
}

export async function clearSession(db: AnyPgDatabase, telegramUserId: number): Promise<void> {
  await db.delete(telegramSessions).where(eq(telegramSessions.telegramUserId, telegramUserId));
}
