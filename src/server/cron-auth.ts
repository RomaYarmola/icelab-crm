import { timingSafeEqual } from "node:crypto";

/** Заголовок із секретом розкладу (Supabase Cron, D29). */
export const CRON_SECRET_HEADER = "x-cron-secret";

/**
 * Перевіряє секрет розкладу в заголовку. Без налаштованого `CRON_SECRET` відповідь завжди «ні»:
 * адреса розкладу не повинна бути відкритою, навіть якщо секрет забули задати.
 */
export function isCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const given = request.headers.get(CRON_SECRET_HEADER)?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
