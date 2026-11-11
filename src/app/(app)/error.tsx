"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/errorState/ErrorState";

/**
 * Помилка на сторінці розділу: показуємо її всередині оболонки, меню лишається. У цій версії
 * Next.js для повторної спроби передається `retry` (не `reset`).
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Подробиці лише в журнал, на екран не виводимо (вимога ТЗ).
    console.error(error);
  }, [error]);

  return <ErrorState onRetry={retry} />;
}
