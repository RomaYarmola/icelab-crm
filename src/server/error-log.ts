import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { errorLog } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Журнал помилок сервера (таблиця `error_log`). Запис ніколи не ламає запит: якщо базу не вдалося
 * дописати (немає таблиці, збій з'єднання), помилка лишається лише в журналі Vercel.
 */

export type ErrorSource = "render" | "route" | "action" | "proxy" | "form_action";

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 4000;
export const MAX_PATH_LENGTH = 300;
/** Однакові помилки протягом цього часу рахуємо в одному рядку. */
export const DEDUPE_WINDOW_MINUTES = 60;
export const RETENTION_DAYS = 30;
/** Запас міцності: більше рядків за раз у журналі не тримаємо. */
export const MAX_ROWS = 1000;

export type ErrorLogEntry = {
  source: ErrorSource;
  error: unknown;
  /** Адреса запиту: параметри (`?...`) відкидаємо, бо там можуть бути особисті дані. */
  path?: string;
  method?: string;
};

/** Текст, початок стеку й digest із будь-якого значення, яке кинули як помилку. */
export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  return {
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    stack: stack?.slice(0, MAX_STACK_LENGTH),
    digest,
  };
}

/** Адреса без параметрів запиту й фрагмента, обрізана. */
export function cleanPath(path: string | undefined): string | null {
  if (!path) return null;
  return (path.split(/[?#]/)[0] ?? "").slice(0, MAX_PATH_LENGTH) || null;
}

/** Дописує помилку в журнал: повторну за годину лише рахує. Кидає помилку бази як є. */
export async function writeErrorLog(db: AnyPgDatabase, entry: ErrorLogEntry): Promise<void> {
  const { message, stack, digest } = describeError(entry.error);
  const path = cleanPath(entry.path);
  const method = entry.method?.slice(0, 10) ?? null;

  const recentSame = and(
    eq(errorLog.source, entry.source),
    eq(errorLog.message, message),
    path === null ? sql`${errorLog.path} is null` : eq(errorLog.path, path),
    gt(errorLog.lastSeenAt, sql`now() - make_interval(mins => ${DEDUPE_WINDOW_MINUTES})`),
  );

  const [repeated] = await db
    .update(errorLog)
    .set({ count: sql`${errorLog.count} + 1`, lastSeenAt: sql`now()` })
    .where(recentSame)
    .returning({ id: errorLog.id });

  if (!repeated) {
    await db
      .insert(errorLog)
      .values({ source: entry.source, message, digest, stack, path, method });
  }

  // Прибирання: старше за строк зберігання і все, що понад ліміт (найстаріші спершу).
  await db
    .delete(errorLog)
    .where(lt(errorLog.lastSeenAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`));
  await db.execute(sql`
    delete from error_log
    where id in (
      select id from error_log order by last_seen_at desc offset ${MAX_ROWS}
    )
  `);
}

/**
 * Записує помилку в журнал і в консоль сервера. Ніколи не кидає помилок: якщо запис у базу не
 * вдався, про це лише повідомляємо в консоль.
 */
export async function reportError(entry: ErrorLogEntry): Promise<void> {
  console.error(`Помилка (${entry.source}):`, entry.error);
  try {
    await writeErrorLog(getDb(), entry);
  } catch (writeError) {
    console.error("Журнал помилок: не вдалося записати в базу.", writeError);
  }
}
