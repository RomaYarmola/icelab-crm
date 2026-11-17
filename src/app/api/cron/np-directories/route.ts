import { getDb } from "@/db/client";
import { isCronRequest } from "@/server/cron-auth";
import { reportError } from "@/server/error-log";
import { NpError } from "@/server/np/client";
import { runDirectorySync } from "@/server/np/directories";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };

/**
 * Розклад: оновлення довідників Нової Пошти (B10, D125). Кожен виклик завантажує кілька сторінок і
 * запам'ятовує, де зупинився, тож розклад викликає адресу часто, а коли оновлювати нічого, відповідь
 * `fresh` приходить одразу. Без правильного секрету в заголовку `x-cron-secret` це 401.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  try {
    const result = await runDirectorySync(getDb());
    return Response.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof NpError) {
      // Мережа чи Нова Пошта тимчасово недоступні: наступний виклик розкладу продовжить з цієї сторінки.
      return Response.json({ error: error.message }, { status: 502, headers: noStore });
    }
    await reportError({ source: "route", error, path: "/api/cron/np-directories" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}

export const GET = handle;
export const POST = handle;
