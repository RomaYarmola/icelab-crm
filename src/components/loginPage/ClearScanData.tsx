"use client";

import { useEffect } from "react";
import { SCAN_CACHE_NAME } from "@/constants/boxes";
import { openScanStores } from "@/utils/scanQueueDb";

/**
 * На сторінці входу прибирає з телефона те, що належало попередньому користувачеві (D112): збережену
 * оболонку сканера й список замовлень для офлайн-режиму. Скани, що ще не відправлені, лишаємо:
 * їх не можна втрачати, вони підуть, коли хтось увійде.
 */
export default function ClearScanData() {
  useEffect(() => {
    void (async () => {
      try {
        await caches.delete(SCAN_CACHE_NAME);
        const stores = await openScanStores();
        await stores.meta.set("orders", undefined);
      } catch {
        // Немає кешу чи IndexedDB: прибирати нічого.
      }
    })();
  }, []);
  return null;
}
