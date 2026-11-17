import { after } from "next/server";
import { getDb } from "@/db/client";
import { reportError } from "@/server/error-log";
import { processAndReply } from "@/server/intake/telegram-flow";
import { handleUpdate, type TgUpdate } from "@/server/telegram/updates";
import { isTelegramRequest } from "@/server/telegram/webhook-auth";

export const dynamic = "force-dynamic";
// Розбір заявки йде після відповіді Telegram (D138), але в межах життя функції.
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

/**
 * Приймач подій Telegram (B11, ТЗ 8.2). Без правильного секрету в заголовку це 401 і нічого не
 * пишеться. Відповідаємо 200 і тоді, коли обробка не вдалась (помилка йде в журнал помилок), щоб
 * Telegram не повторював ту саму подію без кінця.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isTelegramRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return Response.json({ error: "Некоректний запит." }, { status: 400, headers: noStore });
  }
  try {
    const db = getDb();
    const outcome = await handleUpdate(db, update);
    // Нова чи змінена заявка: розбираємо після відповіді (Telegram чекає лише секунди). Якщо не
    // встигне, запасний розклад `intake-retry` добере повідомлення.
    if ((outcome.kind === "stored" && outcome.status === "new") || outcome.kind === "updated") {
      const messageId = outcome.id;
      after(async () => {
        try {
          await processAndReply(db, messageId);
        } catch (error) {
          await reportError({ source: "route", error, path: "/api/telegram/webhook" });
        }
      });
    }
    return Response.json({ ok: true, outcome: outcome.kind }, { headers: noStore });
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/telegram/webhook" });
    return Response.json({ ok: false }, { headers: noStore });
  }
}
