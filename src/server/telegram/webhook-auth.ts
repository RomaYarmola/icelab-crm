import { timingSafeEqual } from "node:crypto";
import { getTelegramWebhookSecret } from "./client";

/** Заголовок, яким Telegram підписує запити webhook (`secret_token` з `setWebhook`). */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Перевіряє секрет webhook. Без налаштованого `TELEGRAM_WEBHOOK_SECRET` відповідь завжди «ні»:
 * адреса приймача не повинна бути відкритою, навіть якщо секрет забули задати.
 */
export function isTelegramRequest(request: Request): boolean {
  const expected = getTelegramWebhookSecret();
  const given = request.headers.get(TELEGRAM_SECRET_HEADER)?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
