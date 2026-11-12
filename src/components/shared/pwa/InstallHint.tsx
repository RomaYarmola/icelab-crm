"use client";

import { useSyncExternalStore } from "react";
import { shouldShowInstallHint } from "@/utils/installHint";
import Notification from "../notification/Notification";

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(STANDALONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return shouldShowInstallHint({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    // `navigator.standalone` є лише в Safari на iOS (display-mode там не завжди спрацьовує).
    isStandalone:
      window.matchMedia(STANDALONE_QUERY).matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
}

/**
 * Підказка для iPhone і iPad: як додати CRM на головний екран. На iPhone немає автоматичного
 * запиту, тому показуємо її на сторінці «Ще». В Android і на комп'ютері, а також коли застосунок уже
 * відкрито з головного екрана, нічого не показує.
 */
export default function InstallHint() {
  const isVisible = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!isVisible) return null;

  return (
    <Notification variant="info" title="Додайте застосунок на головний екран">
      Натисніть «Поділитися» внизу екрана Safari, потім «На початковий екран». Так CRM
      відкриватиметься як звичайний застосунок.
    </Notification>
  );
}
