"use client";

import { RealtimeClient } from "@supabase/realtime-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { PRODUCTION_REFRESH } from "@/constants/production";
import type { ProductionRealtimeConfig } from "@/server/production-signal";

/**
 * Живе оновлення екрана виробництва (D64). Основа це сигнал із каналу Supabase Realtime Broadcast:
 * сервер після зміни замовлення шле порожнє повідомлення, а екран у відповідь перезавантажує дані
 * через сервер (`router.refresh`). Дані по каналу не йдуть, браузер у базу не читає.
 *
 * Сигнал не гарантує доставку, тож є запасний механізм: опитування раз на 45 секунд, поки канал
 * живий, і раз на 15 секунд, коли каналу немає; оновлення при поверненні на вкладку чи зв'язку, і
 * після відновлення каналу. Поки вкладка не видна, не опитуємо.
 */

export type LiveStatus = "connecting" | "live" | "down";

const EVENT_NAME = "changed";

export function useProductionLive(config: ProductionRealtimeConfig | null): {
  status: LiveStatus;
  refresh: () => void;
} {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>(config ? "connecting" : "down");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // Кілька сигналів поспіль зливаємо в одне оновлення.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      startTransition(() => router.refresh());
    }, PRODUCTION_REFRESH.signalDebounceMs);
  }, [router]);

  // Об'єкт налаштувань приходить із сервера новим при кожному оновленні, тож стежимо за значеннями.
  const url = config?.url ?? "";
  const publishableKey = config?.publishableKey ?? "";
  const topicsKey = config?.topics.join("|") ?? "";

  useEffect(() => {
    if (!url || !publishableKey || !topicsKey) return;
    const topics = topicsKey.split("|");
    const client = new RealtimeClient(`wss://${new URL(url).host}/realtime/v1`, {
      params: { apikey: publishableKey },
    });
    const ready = new Set<string>();
    let wasDown = false;

    const channels = topics.map((topic) => {
      const channel = client.channel(topic, { config: { broadcast: { self: false } } });
      channel.on("broadcast", { event: EVENT_NAME }, scheduleRefresh);
      channel.subscribe((state) => {
        if (state === "SUBSCRIBED") {
          ready.add(topic);
          if (ready.size === topics.length) {
            setStatus("live");
            // Поки каналу не було, сигнали могли пропасти: підтягуємо зміни.
            if (wasDown) scheduleRefresh();
            wasDown = false;
          }
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          ready.delete(topic);
          wasDown = true;
          setStatus("down");
        }
      });
      return channel;
    });

    return () => {
      for (const channel of channels) void channel.unsubscribe();
      void client.disconnect();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [url, publishableKey, topicsKey, scheduleRefresh]);

  // Запасне опитування: рідше, коли канал живий, частіше, коли його немає.
  useEffect(() => {
    const delay =
      status === "live" ? PRODUCTION_REFRESH.liveIntervalMs : PRODUCTION_REFRESH.fallbackIntervalMs;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    }, delay);
    return () => clearInterval(id);
  }, [status, refresh]);

  // Повернулись на вкладку чи відновився зв'язок: одразу свіжі дані.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  return { status, refresh };
}
