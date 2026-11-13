import type { Metadata } from "next";
import ExportAllContent from "@/components/exportPage/ExportAllContent";
import { can } from "@/server/permissions";
import { requirePageUser } from "@/server/page-access";

export const metadata: Metadata = { title: "Експорт усього" };

/**
 * «Експорт усього»: уся база одним файлом Excel. Лише власник. Сам файл готує адреса
 * `/api/export/all`, права на нього перевіряє `exportEverything`. Layout і сторінка рендеряться
 * паралельно, тому сторінка теж перевіряє розділ.
 */
export default async function ExportPage() {
  const user = await requirePageUser("export");
  return <ExportAllContent canSeeJournal={can(user.role, "audit_log", "read")} />;
}
