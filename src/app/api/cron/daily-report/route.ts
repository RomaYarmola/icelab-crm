import { getDb } from "@/db/client";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { runDailyReport } from "@/server/telegram/daily-report";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

/**
 * Вечірнє зведення власнику в Telegram (B11, D150). Розклад викликає адресу кожні півгодини, а
 * зведення йде один раз на день, коли настав час із налаштування `report.daily_time`. Без правильного
 * секрету в заголовку `x-cron-secret` це 401.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  try {
    const result = await runDailyReport(getDb());
    return Response.json(result, { headers: noStore });
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/cron/daily-report" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
