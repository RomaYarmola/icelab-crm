import { eq, inArray } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Налаштування Telegram у таблиці `settings` (ТЗ 4.1): група, топіки Київ і Львів, чат власника.
 * Пишуться рідко (при налаштуванні), тож журнал змін їх тримає. Значення «ще не задано» це `null`.
 */

export const TELEGRAM_KEYS = {
  groupChatId: "telegram.group_chat_id",
  topicKyiv: "telegram.topic_kyiv_id",
  topicLviv: "telegram.topic_lviv_id",
  ownerChatId: "telegram.owner_chat_id",
  capture: "telegram.capture",
  botUsername: "telegram.bot_username",
} as const;

/** Який топік зараз «визначаємо»: наступне повідомлення власника в ньому запам'ятає його номер. */
export type TopicCapture = { target: "kyiv" | "lviv"; expiresAt: string };

export type TelegramSettings = {
  groupChatId: number | null;
  topicKyiv: number | null;
  topicLviv: number | null;
  ownerChatId: number | null;
  capture: TopicCapture | null;
  botUsername: string | null;
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export async function getTelegramSettings(db: AnyPgDatabase): Promise<TelegramSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(TELEGRAM_KEYS)));
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const capture = byKey.get(TELEGRAM_KEYS.capture) as TopicCapture | null | undefined;
  return {
    groupChatId: asNumber(byKey.get(TELEGRAM_KEYS.groupChatId)),
    topicKyiv: asNumber(byKey.get(TELEGRAM_KEYS.topicKyiv)),
    topicLviv: asNumber(byKey.get(TELEGRAM_KEYS.topicLviv)),
    ownerChatId: asNumber(byKey.get(TELEGRAM_KEYS.ownerChatId)),
    capture:
      capture && (capture.target === "kyiv" || capture.target === "lviv") && capture.expiresAt
        ? capture
        : null,
    botUsername:
      typeof byKey.get(TELEGRAM_KEYS.botUsername) === "string"
        ? (byKey.get(TELEGRAM_KEYS.botUsername) as string)
        : null,
  };
}

/** Записує одне або кілька налаштувань однією транзакцією від імені користувача (чи системи). */
export async function setTelegramSettings(
  db: AnyPgDatabase,
  actorId: string | null,
  values: Partial<Record<keyof typeof TELEGRAM_KEYS, unknown>>,
): Promise<void> {
  const entries = Object.entries(values) as [keyof typeof TELEGRAM_KEYS, unknown][];
  if (entries.length === 0) return;
  await withActor(db, actorId, async (tx) => {
    for (const [name, value] of entries) {
      const key = TELEGRAM_KEYS[name];
      // «Не задано» це відсутній рядок: значення в таблиці не може бути порожнім.
      if (value === null || value === undefined) {
        await tx.delete(settings).where(eq(settings.key, key));
        continue;
      }
      const existing = await tx
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, key));
      if (existing.length > 0) {
        await tx
          .update(settings)
          .set({ value: value as object })
          .where(eq(settings.key, key));
      } else {
        await tx.insert(settings).values({ key, value: value as object });
      }
    }
  });
}

/** Топік активний, поки не минув час очікування. */
export function isCaptureActive(capture: TopicCapture | null, now: Date = new Date()): boolean {
  return capture !== null && new Date(capture.expiresAt).getTime() > now.getTime();
}
