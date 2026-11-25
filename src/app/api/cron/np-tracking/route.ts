import { getDb } from "@/db/client";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { NpError } from "@/server/np/client";
import { trackReturns } from "@/server/np/returns";
import { trackShipments } from "@/server/np/tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };

/**
 * Розклад: трекінг накладних Нової Пошти кожні 15 хвилин (B10, ТЗ 8.7). Без правильного секрету в
 * заголовку `x-cron-secret` це 401. Помилка Нової Пошти не ламає стан: розклад повторить за 15 хвилин.
 * Тим самим запуском шукаємо й відстежуємо повернення боксів (B17); їхній збій не ховає результат
 * основного трекінгу.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  try {
    const result = await trackShipments(getDb());
    return Response.json({ ...result, returns: await returnsSafely() }, { headers: noStore });
  } catch (error) {
    if (error instanceof NpError) {
      return Response.json({ error: error.message }, { status: 502, headers: noStore });
    }
    await reportError({ source: "route", error, path: "/api/cron/np-tracking" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

async function returnsSafely() {
  try {
    return await trackReturns(getDb());
  } catch (error) {
    if (error instanceof NpError) return { error: error.message };
    await reportError({ source: "route", error, path: "/api/cron/np-tracking#returns" });
    return { error: "Помилка сервера." };
  }
}

export const GET = handle;
export const POST = handle;
