import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * У Next.js 16 файл `middleware.ts` перейменовано на `proxy.ts`.
 * Тут лише оновлення сесії і швидка перевірка входу, без запитів до бази.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Усе, крім службових файлів Next.js, зображень і файлів застосунку (PWA): маніфест, service
  // worker і сторінка «Немає зв'язку» браузер просить без входу, їм не можна переходити на /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
