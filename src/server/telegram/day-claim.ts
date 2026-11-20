import { eq, sql } from "drizzle-orm";
import { npSyncState } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * «Один раз на київський день» для вечірніх розсилок (зведення D150, список на завтра D160). Спробу
 * займаємо до відправлення умовним оновленням, тож два одночасні виклики не пошлють двічі; коли
 * відправлення не вдалось, спробу звільняємо.
 */
export type DayClaim = { release: () => Promise<void> };

export async function claimDay(
  db: AnyPgDatabase,
  key: string,
  now: Date,
  day: string,
): Promise<DayClaim | null> {
  const [previous] = await db.select().from(npSyncState).where(eq(npSyncState.key, key));
  const claimed = await db
    .insert(npSyncState)
    .values({ key, phase: "idle", lastFinishedAt: now })
    .onConflictDoUpdate({
      target: npSyncState.key,
      set: { lastFinishedAt: now, updatedAt: now },
      setWhere: sql`(${npSyncState.lastFinishedAt} is null
        or (${npSyncState.lastFinishedAt} at time zone 'Europe/Kyiv')::date < ${day}::date)`,
    })
    .returning({ key: npSyncState.key });
  if (claimed.length === 0) return null;
  return {
    release: async () => {
      await db
        .update(npSyncState)
        .set({ lastFinishedAt: previous?.lastFinishedAt ?? null })
        .where(eq(npSyncState.key, key));
    },
  };
}
