import { requirePageUser } from "@/server/page-access";

/**
 * Захист екрана «Журнал змін»: власник і бухгалтер, інші переходять на свою початкову сторінку.
 * Перевірка в layout, щоб відбуватись до відповіді. Права на читання перевіряє `server/audit.ts`.
 */
export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("audit");
  return children;
}
