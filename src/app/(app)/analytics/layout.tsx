import { requirePageUser } from "@/server/page-access";

/**
 * Захист розділу «Аналітика» (власник, менеджер, бухгалтер): інші ролі переходять на свою початкову
 * сторінку. Перевірка в layout, щоб відбуватись до відповіді.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("analytics");
  return children;
}
