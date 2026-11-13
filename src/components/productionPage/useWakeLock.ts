"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Не дає екрану планшета гаснути (Screen Wake Lock, D66). Браузер скидає блокування, коли вкладка
 * ховається, тому при поверненні беремо його знову. Там, де браузер цього не вміє (старі планшети,
 * iPhone), повертає `supported: false`: екран тоді підказує вимкнути автоблокування в налаштуваннях.
 */

const subscribeNever = () => () => undefined;
const getSupported = () => "wakeLock" in navigator;

export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  // На сервері вважаємо, що підтримка є: підказка про її відсутність з'являється лише в браузері.
  const supported = useSyncExternalStore(subscribeNever, getSupported, () => true);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!enabled || !supported) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        setHeld(true);
        next.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [enabled, supported]);

  return { supported, active: enabled && supported && held };
}
