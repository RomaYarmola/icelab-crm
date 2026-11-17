import { and, asc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { intakeMessages } from "@/db/schema";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { processAndReply } from "@/server/intake/telegram-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
/** Беремо лише повідомлення, що чекають довше за цей час: свіжі ще розбирає відповідь webhook. */
const MIN_AGE_MS = 60_000;
/** Скільки повідомлень за один виклик: кожне це виклик Claude до 20 секунд. */
const BATCH = 3;

/**
 * Запасний розбір заявок (B11, D138): щохвилини добирає повідомлення, що застрягли в «нове» (функція
 * впала чи не встигла). Без правильного секрету в заголовку `x-cron-secret` це 401.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  const db = getDb();
  try {
    const stuck = await db
      .select({ id: intakeMessages.id })
      .from(intakeMessages)
      .where(
        and(
          eq(intakeMessages.parseStatus, "new"),
          lt(intakeMessages.updatedAt, new Date(Date.now() - MIN_AGE_MS)),
        ),
      )
      .orderBy(asc(intakeMessages.createdAt))
      .limit(BATCH);
    const results: string[] = [];
    for (const row of stuck) {
      const outcome = await processAndReply(db, row.id);
      results.push(outcome.status);
    }
    return Response.json({ processed: stuck.length, results }, { headers: noStore });
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/cron/intake-retry" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
