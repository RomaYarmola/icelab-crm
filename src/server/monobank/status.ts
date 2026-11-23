import { asc, eq } from "drizzle-orm";
import { bankAccounts } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { type AppUser, requirePermission } from "../guards";
import { getMonobankToken } from "./client";
import { runMonobankSync, type SyncResult } from "./sync";

/** Стан підключення monobank для екрана «Оплати» (B13): токен «є/немає», рахунки, остання синхронізація. */
export type MonobankStatus = {
  hasToken: boolean;
  accounts: { id: string; label: string; lastSyncedAt: Date | null; lastError: string | null }[];
};

export async function getMonobankStatus(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<MonobankStatus> {
  requirePermission(actor, "bank_payments", "read");
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.provider, "monobank"))
    .orderBy(asc(bankAccounts.createdAt));
  return {
    hasToken: getMonobankToken() !== null,
    accounts: rows.map((row) => ({
      id: row.id,
      label: row.label,
      lastSyncedAt: row.lastSyncedAt,
      lastError: row.lastError,
    })),
  };
}

/** Текст результату для кнопки «Перевірити з'єднання й забрати виписку». */
export function describeSync(result: SyncResult & { accountsFound: number | null }): string {
  if (result.errors.length > 0) return result.errors.join(" ");
  if (result.accounts === 0) return "Рахунку ФОП у гривні не знайдено. Перевірте токен.";
  if (result.skipped === result.accounts) {
    return "Виписку щойно забирали: банк дозволяє один запит на хвилину. Спробуйте за хвилину.";
  }
  return `З'єднання працює. Нових платежів: ${result.inserted}.`;
}

/** Ручний запуск того самого, що робить розклад (власник і бухгалтер). */
export async function syncMonobankNow(db: AnyPgDatabase, actor: AppUser): Promise<string> {
  requirePermission(actor, "bank_payments", "write");
  const result = await runMonobankSync(db);
  return describeSync(result);
}
