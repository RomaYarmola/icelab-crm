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
  // Усе, крім службових файлів Next.js і зображень.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
