import { timingSafeEqual } from "node:crypto";

/** Заголовок із спільним секретом сайту (ТЗ 8.1). */
export const LEAD_SECRET_HEADER = "x-lead-secret";

/**
 * Перевіряє секрет сайту. Без налаштованого `LEAD_SITE_SECRET` відповідь завжди «ні»: приймач заявок
 * не повинен бути відкритим, навіть якщо секрет забули задати.
 */
export function isSiteRequest(request: Request): boolean {
  const expected = process.env.LEAD_SITE_SECRET?.trim();
  const given = request.headers.get(LEAD_SECRET_HEADER)?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
