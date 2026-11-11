"use client";

import "./globals.css";
import { useEffect } from "react";
import ErrorState from "@/components/shared/errorState/ErrorState";

/**
 * Помилка в кореневому layout. Замінює весь документ, тому сама містить html і body.
 * Стилі підключаємо тут, бо кореневий layout не відпрацював.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="uk">
      <body className="font-system text-body text-navy antialiased">
        <main className="flex min-h-dvh items-center justify-center px-4 py-10">
          <ErrorState className="w-full max-w-sm" onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
