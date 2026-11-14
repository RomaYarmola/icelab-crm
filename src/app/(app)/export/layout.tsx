import { requirePageUser } from "@/server/page-access";

/**
 * Захист екрана «Експорт усього»: лише власник, інші переходять на свою початкову сторінку.
 * Перевірка в layout, щоб відбуватись до відповіді. Право на дані перевіряє `server/export.ts`.
 */
export default async function ExportLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("export");
  return children;
}
