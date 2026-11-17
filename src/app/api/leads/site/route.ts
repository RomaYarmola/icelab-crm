import { getDb } from "@/db/client";
import { reportError } from "@/server/error-log";
import { receiveSiteLead, validateSiteLead } from "@/server/intake/site-lead";
import { isSiteRequest } from "@/server/intake/site-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };

/**
 * Приймач заявок із сайту (B11, ТЗ 8.1): `POST` із заголовком `X-Lead-Secret` і тілом
 * `{lead, message, receivedAt}`. Відповідь `200 {draftId}` або 4xx/5xx, сайт помилку лише логує і форму
 * не ламає. Без правильного секрету це 401 і нічого не пишеться.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSiteRequest(request)) {
    return Response.json({ error: "Немає доступу." }, { status: 401, headers: noStore });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некоректний запит." }, { status: 400, headers: noStore });
  }
  // Помилки запиту відповідаємо до звернення до бази.
  const invalid = validateSiteLead(body);
  if (invalid)
    return Response.json({ error: invalid.error }, { status: invalid.status, headers: noStore });
  try {
    const result = await receiveSiteLead(getDb(), body);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status, headers: noStore });
    }
    return Response.json(
      { draftId: result.draftId, duplicate: result.duplicate },
      { headers: noStore },
    );
  } catch (error) {
    await reportError({ source: "route", error, path: "/api/leads/site" });
    return Response.json({ error: "Помилка сервера." }, { status: 500, headers: noStore });
  }
}
