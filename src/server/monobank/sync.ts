import { and, desc, eq, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { bankAccounts, integrationLogs, payments, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { matchNewPayments } from "../payments";
import { sendMessage } from "../telegram/client";
import { getTelegramSettings } from "../telegram/settings";
import {
  fetchClientInfo,
  fetchStatement,
  MonobankError,
  type MonobankAccount,
  type MonobankStatementItem,
} from "./client";

/**
 * Забір виписки monobank (B13, ТЗ 8.5, D186). Беремо лише рахунок ФОП у гривні й лише надходження.
 * Виписку просимо від «до чого дійшли мінус 2 дні» (перекриття для надійності); дублі відсікає
 * унікальний індекс за `id` операції. Не частіше одного запиту на 60 с на рахунок (ліміт банку).
 */

export const UAH = 980;
const DAY_MS = 86_400_000;
export const MAX_WINDOW_MS = 31 * DAY_MS;
const OVERLAP_MS = 2 * DAY_MS;
export const MIN_INTERVAL_MS = 60_000;
export const ALERT_KEY = "monobank.token_alert";

type Fetchers = {
  info?: typeof fetchClientInfo;
  statement?: typeof fetchStatement;
  /** Підміна відправки повідомлення власнику (тести). */
  notify?: (text: string) => Promise<unknown>;
  now?: Date;
};

/** Рахунок ФОП у гривні з відповіді `client-info`; особисті рахунки відкидаємо. */
export function pickFopAccounts(
  accounts: readonly MonobankAccount[] | undefined,
): MonobankAccount[] {
  return (accounts ?? []).filter(
    (account) => account.type === "fop" && account.currencyCode === UAH && Boolean(account.id),
  );
}

/** Надходження в гривні: лише такі йдуть у виписку (ТЗ 8.5). */
export function isIncomingUah(item: MonobankStatementItem): boolean {
  return item.amount > 0 && item.currencyCode === UAH && Boolean(item.id);
}

const kopecksToUah = (kopecks: number): string => (kopecks / 100).toFixed(2);

/** Оновлює список рахунків ФОП. Повертає, скільки рахунків ФОП знайдено. */
export async function syncAccounts(db: AnyPgDatabase, fetchers: Fetchers = {}): Promise<number> {
  const info = await (fetchers.info ?? fetchClientInfo)(db);
  const fops = pickFopAccounts([
    ...(info.accounts ?? []),
    ...(info.managedClients ?? []).flatMap((client) => client.accounts ?? []),
  ]);
  for (const account of fops) {
    await db
      .insert(bankAccounts)
      .values({
        provider: "monobank",
        accountId: account.id,
        label: "ФОП, гривня",
        currency: "UAH",
        isFop: true,
      })
      .onConflictDoNothing();
  }
  return fops.length;
}

export type SyncResult = {
  accounts: number;
  /** Скільки нових платежів зіставлено автоматично після виписки. */
  matched?: number;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
};

/** Забирає виписку по кожному рахунку ФОП. Помилка одного рахунку не зупиняє інші. */
export async function syncStatements(
  db: AnyPgDatabase,
  fetchers: Fetchers = {},
): Promise<SyncResult> {
  const now = fetchers.now ?? new Date();
  const result: SyncResult = { accounts: 0, fetched: 0, inserted: 0, skipped: 0, errors: [] };
  const rows = await db.select().from(bankAccounts).where(eq(bankAccounts.provider, "monobank"));
  for (const account of rows) {
    result.accounts += 1;
    if (account.lastSyncedAt && now.getTime() - account.lastSyncedAt.getTime() < MIN_INTERVAL_MS) {
      result.skipped += 1;
      continue;
    }
    const base = account.lastStatementTo
      ? new Date(account.lastStatementTo.getTime() - OVERLAP_MS)
      : new Date(now.getTime() - MAX_WINDOW_MS);
    const from = new Date(Math.max(base.getTime(), now.getTime() - MAX_WINDOW_MS * 12));
    const to = new Date(Math.min(now.getTime(), from.getTime() + MAX_WINDOW_MS));
    try {
      const items = await (fetchers.statement ?? fetchStatement)(db, account.accountId, from, to);
      result.fetched += items.length;
      for (const item of items.filter(isIncomingUah)) {
        const inserted = await db
          .insert(payments)
          .values({
            bankAccountId: account.id,
            externalId: item.id,
            occurredAt: new Date(item.time * 1000),
            amount: kopecksToUah(item.amount),
            currency: "UAH",
            description: item.description ?? null,
            counterName: item.counterName ?? null,
            counterIban: item.counterIban ?? null,
            comment: item.comment ?? null,
            raw: item,
            importedVia: "api",
          })
          .onConflictDoNothing()
          .returning({ id: payments.id });
        result.inserted += inserted.length;
      }
      await db
        .update(bankAccounts)
        .set({ lastStatementTo: to, lastSyncedAt: now, lastError: null })
        .where(eq(bankAccounts.id, account.id));
    } catch (error) {
      if (!(error instanceof MonobankError)) throw error;
      result.errors.push(error.message);
      await db
        .update(bankAccounts)
        .set({ lastSyncedAt: now, lastError: error.message })
        .where(eq(bankAccounts.id, account.id));
      if (error.isAuth) await alertTokenFailure(db, error.message, fetchers);
      // Ліміт банку стосується всього токена: далі не пробуємо.
      if (error.isRateLimited) break;
    }
  }
  return result;
}

/** Повідомляє власника про відмову токена один раз, доки не з'явиться успішна синхронізація. */
export async function alertTokenFailure(
  db: AnyPgDatabase,
  message: string,
  fetchers: Pick<Fetchers, "notify"> = {},
): Promise<boolean> {
  const [flag] = await db.select().from(settings).where(eq(settings.key, ALERT_KEY));
  if (flag) return false;
  await withActor(db, null, (tx) =>
    tx.insert(settings).values({ key: ALERT_KEY, value: { at: new Date().toISOString() } }),
  );
  const { ownerChatId } = await getTelegramSettings(db);
  if (ownerChatId === null && !fetchers.notify) return false;
  const text = `Токен monobank не працює. ${message}`;
  try {
    if (fetchers.notify) await fetchers.notify(text);
    else await sendMessage(db, { chatId: ownerChatId!, text });
  } catch {
    // Не вдалося написати власнику: помилка лишилась у журналі інтеграцій.
  }
  return true;
}

/** Після успішної синхронізації знімає позначку, щоб наступна відмова знову сповістила власника. */
export async function clearTokenAlert(db: AnyPgDatabase): Promise<void> {
  await withActor(db, null, (tx) => tx.delete(settings).where(eq(settings.key, ALERT_KEY)));
}

/** Повний прохід розкладу: рахунки (якщо ще немає чи давно не оновлювали), потім виписка. */
export async function runMonobankSync(
  db: AnyPgDatabase,
  fetchers: Fetchers = {},
): Promise<SyncResult & { accountsFound: number | null }> {
  const now = fetchers.now ?? new Date();
  const existing = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.provider, "monobank"));
  // Список рахунків оновлюємо раз на добу: дивимось, коли `client-info` востаннє вдався.
  const [lastInfo] = await db
    .select({ at: integrationLogs.createdAt })
    .from(integrationLogs)
    .where(
      and(
        eq(integrationLogs.service, "monobank"),
        eq(integrationLogs.operation, "client-info"),
        isNull(integrationLogs.errorText),
      ),
    )
    .orderBy(desc(integrationLogs.createdAt))
    .limit(1);
  const stale =
    existing.length === 0 || !lastInfo || now.getTime() - lastInfo.at.getTime() > DAY_MS;
  let accountsFound: number | null = null;
  if (stale) {
    try {
      accountsFound = await syncAccounts(db, fetchers);
    } catch (error) {
      if (!(error instanceof MonobankError)) throw error;
      if (error.isAuth) await alertTokenFailure(db, error.message, fetchers);
      return {
        accounts: 0,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        errors: [error.message],
        accountsFound: null,
      };
    }
  }
  const result = await syncStatements(db, fetchers);
  // Зіставлення одразу після виписки (ТЗ 8.7); помилка одного платежу виписку не ламає.
  try {
    result.matched = (await matchNewPayments(db)).matched;
  } catch {
    result.errors.push("Не вдалося зіставити платежі: спробуємо наступного разу.");
  }
  if (result.errors.length === 0 && result.accounts > 0) await clearTokenAlert(db);
  return { ...result, accountsFound };
}
