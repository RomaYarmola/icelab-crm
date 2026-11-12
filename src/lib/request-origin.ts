/**
 * Адреса, з якої користувач відкрив застосунок (схема і хост), за заголовками запиту.
 * Потрібна, щоб після входу через Google повернути користувача на ту саму адресу: на комп'ютері
 * розробника це `http://localhost:3000`, на прев'ю Vercel його адреса, у бойовому середовищі
 * `https://icelab-crm.vercel.app`.
 *
 * Заголовку `host` не довіряємо наосліп: приймаємо лише хост із літер, цифр, крапок, дефісів
 * і порта. До того ж Supabase повертає користувача лише на адреси зі списку дозволених
 * (Authentication, URL Configuration), тож підроблений хост нікуди не приведе.
 */
export function originFromHeaders(headers: Headers): string {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;

  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"));
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    throw new Error("Не вдалося визначити адресу застосунку.");
  }

  const forwardedProto = first(headers.get("x-forwarded-proto"));
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";

  return `${protocol}://${host}`;
}
