import { requirePageUser } from "@/server/page-access";

/**
 * Захист розділу «Бокси»: роль без права на нього переходить на свою початкову сторінку.
 * Перевірка в layout, а не в сторінці, щоб відбуватись до відповіді (код 307 замість 200) і
 * щоб `loading.tsx` розділу, коли з'явиться, не обгортав її в Suspense.
 */
export default async function BoxesLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("boxes");
  return children;
}
