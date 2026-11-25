import { getDb } from "@/db/client";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { runReminders } from "@/server/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

/**
 * Розклад: ранкові нагадування (B14, ТЗ 7.7, 8.7). Адресу викликають кожні 30 хвилин, а складання й
 * надсилання відбувається один раз на київський день і не раніше 09:00 (`report.reminders_time`).
 * Без правильного секрету в заголовку `x-cron-secret` це 401.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  try {
    return Response.json(await runReminders(getDb()), { headers: noStore });
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/cron/reminders" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
