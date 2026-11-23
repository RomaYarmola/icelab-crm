import { getDb } from "@/db/client";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { runMonobankSync } from "@/server/monobank/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

/**
 * Розклад: виписка monobank кожні 15 хвилин (B13, ТЗ 8.7). Без правильного секрету в заголовку
 * `x-cron-secret` це 401. Помилка банку не ламає стан: розклад повторить за 15 хвилин.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  try {
    const result = await runMonobankSync(getDb());
    return Response.json(result, { headers: noStore });
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/cron/monobank" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
