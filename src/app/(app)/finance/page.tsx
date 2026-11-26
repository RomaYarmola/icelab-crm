import type { Metadata } from "next";
import {
  addCo2ReceiptAction,
  addIceWriteoffAction,
  deleteCo2AdjustmentAction,
  deleteCo2NormAction,
  deleteCo2ReceiptAction,
  deleteIceWriteoffAction,
  setCo2NormAction,
  setCo2StockAction,
} from "@/app/(app)/finance/actions";
import FinancePageContent from "@/components/financePage/FinancePageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { getCo2Page } from "@/server/finance/co2";

export const metadata: Metadata = { title: "Фінрезультат" };

/** Фінрезультат (B15): поки що облік сировини CO2 по містах. */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const user = await requireUser();
  const { location } = await searchParams;
  const data = await getCo2Page(getDb(), user, { location });

  return (
    <FinancePageContent
      data={data}
      actions={{
        addReceipt: addCo2ReceiptAction,
        addWriteoff: addIceWriteoffAction,
        setStock: setCo2StockAction,
        setNorm: setCo2NormAction,
        deleteReceipt: deleteCo2ReceiptAction,
        deleteWriteoff: deleteIceWriteoffAction,
        deleteAdjustment: deleteCo2AdjustmentAction,
        deleteNorm: deleteCo2NormAction,
      }}
    />
  );
}
