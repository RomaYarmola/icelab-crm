import type { Metadata } from "next";
import ReportContent from "@/components/financePage/ReportContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getMonthReport } from "@/server/finance/month";

export const metadata: Metadata = { title: "Фінрезультат" };

/** Звіт «Фінансовий результат» за місяць (B15, фаза Б4). Доступ лише власнику (layout і сервер). */
export default async function FinanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; currency?: string }>;
}) {
  const user = await requireUser();
  const { month, currency } = await searchParams;
  const data = await getMonthReport(getDb(), user, { month });

  return <ReportContent data={data} currency={currency === "usd" ? "usd" : "uah"} />;
}
