"use client";

import { useEffect } from "react";

/**
 * Реєструє service worker (`public/sw.js`) лише у збірці: у розробці кеш заважав би бачити зміни.
 * Нічого не показує. Помилку реєстрації ігноруємо: без service worker застосунок працює як
 * звичайний сайт, лише без сторінки «Немає зв'язку».
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      // updateViaCache: none, щоб оновлення service worker не застрягали в кеші браузера.
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);

  return null;
}
