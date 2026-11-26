import type { Metadata } from "next";
import {
  addCategoryAction,
  closeMonthAction,
  reopenMonthAction,
  saveEntriesAction,
  setCommissionRateAction,
  setUsdRateAction,
  updateCategoryAction,
} from "@/app/(app)/finance/month/actions";
import MonthPageContent from "@/components/financePage/MonthPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getMonthPage } from "@/server/finance/month";

export const metadata: Metadata = { title: "Фінрезультат" };

/** Фінрезультат за місяць (B15): підсумки, витрати, курс, комісійні й закриття. */
export default async function FinanceMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const { month } = await searchParams;
  const data = await getMonthPage(getDb(), user, { month });

  return (
    <MonthPageContent
      data={data}
      actions={{
        saveEntries: saveEntriesAction,
        setUsdRate: setUsdRateAction,
        setCommissionRate: setCommissionRateAction,
        addCategory: addCategoryAction,
        updateCategory: updateCategoryAction,
        close: closeMonthAction,
        reopen: reopenMonthAction,
      }}
    />
  );
}
