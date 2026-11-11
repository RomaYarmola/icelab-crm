"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/errorState/ErrorState";
import Logo from "@/components/shared/logo/Logo";

/**
 * Помилка поза оболонкою (наприклад, на екрані входу). Помилки всередині оболонки
 * показує `(app)/error.tsx`, щоб меню лишалося. Для повторної спроби в цій версії Next.js
 * передається `retry`.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo className="w-28" />
      <ErrorState className="w-full max-w-sm" onRetry={retry} />
    </main>
  );
}
