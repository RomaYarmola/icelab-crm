import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { orders } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { getSupabaseAdminEnv } from "@/env";

/**
 * Сигнал «на екрані виробництва щось змінилось» (D64). Після зміни замовлення сервер шле порожнє
 * повідомлення в канал локації через Supabase Realtime Broadcast (REST), а відкритий екран цеху у
 * відповідь сам перезавантажує дані через сервер. Дані по каналу не йдуть, браузер у базу не
 * читає (D19 цілий): навіть підслухавши канал, нічого не дізнатись, окрім того, що щось змінилось.
 *
 * Канал публічний, тому його назва непередбачувана: підпис (HMAC) від id локації секретним ключем.
 * Сигнал не гарантує доставку, тож екран має запасне опитування (див. `useProductionLive`).
 */

export const PRODUCTION_SIGNAL_EVENT = "changed";

const SEND_TIMEOUT_MS = 3000;

/** Назва каналу локації: непередбачувана без секретного ключа, однакова для того самого id. */
export function productionTopic(locationId: string, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(`production:${locationId}`)
    .digest("base64url");
  return `production-${digest.slice(0, 32)}`;
}

export type ProductionRealtimeConfig = {
  /** Адреса проєкту Supabase. */
  url: string;
  /** Публічний (publishable) ключ: його і так бачить браузер. */
  publishableKey: string;
  /** Канали локацій, за якими стежить екран (одна локація, а власник і менеджер можуть стежити за всіма). */
  topics: string[];
};

/**
 * Усе, що потрібно екрану для підписки на канали локацій. `null`, якщо змінні Supabase не задані
 * чи локацій немає (тоді екран живе лише на запасному опитуванні).
 */
export function getProductionRealtimeConfig(
  locationIds: readonly string[],
): ProductionRealtimeConfig | null {
  if (locationIds.length === 0) return null;
  try {
    const env = getSupabaseAdminEnv();
    return {
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      topics: [...new Set(locationIds)].map((id) => productionTopic(id, env.SUPABASE_SECRET_KEY)),
    };
  } catch {
    return null;
  }
}

type Fetcher = typeof fetch;

/**
 * Надсилає сигнал у канали локацій. Ніколи не кидає помилку: якщо сигнал не дійшов, екран
 * оновиться запасним опитуванням. Повертає, чи сервіс прийняв повідомлення.
 */
export async function sendProductionSignal(
  locationIds: readonly string[],
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const unique = [...new Set(locationIds)];
  if (unique.length === 0) return false;
  try {
    const env = getSupabaseAdminEnv();
    const response = await fetcher(`${env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SECRET_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: unique.map((locationId) => ({
          topic: productionTopic(locationId, env.SUPABASE_SECRET_KEY),
          event: PRODUCTION_SIGNAL_EVENT,
          payload: {},
        })),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Виконує завдання після відповіді користувачу; поза запитом (скрипти, тести) просто запускає його. */
function runAfterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
}

/** Чи налаштований сигнал (змінні Supabase задані). Без них нічого не плануємо. */
function isConfigured(): boolean {
  try {
    getSupabaseAdminEnv();
    return true;
  } catch {
    return false;
  }
}

/** Сигнал для вказаних локацій: після відповіді користувачу, без очікування. */
export function notifyProductionChange(locationIds: readonly string[]): void {
  if (!isConfigured() || locationIds.length === 0) return;
  runAfterResponse(() => sendProductionSignal(locationIds));
}

/** Сигнал для локації замовлення, яке щойно змінили (локацію шукаємо вже після відповіді). */
export function notifyOrderChange(db: AnyPgDatabase, orderId: string): void {
  if (!isConfigured()) return;
  runAfterResponse(async () => {
    const [row] = await db
      .select({ locationId: orders.locationId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (row) await sendProductionSignal([row.locationId]);
  });
}
