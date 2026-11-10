import { isIP } from "node:net";

/**
 * Адреса клієнта за заголовками запиту, для обмеження спроб входу (`login-limiter.ts`).
 *
 * На Vercel заголовки `x-vercel-forwarded-for` і `x-forwarded-for` виставляє сама платформа,
 * підробити їх клієнт не може. Без такого проксі (наприклад, локально) `x-forwarded-for`
 * підробляється, тому обмеження за адресою там лише додаткове, а головне обмеження за e-mail.
 * Повертає `null`, якщо адресу не знайдено або вона має неправильний вигляд.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value) !== 0) return value;
  }
  return null;
}
