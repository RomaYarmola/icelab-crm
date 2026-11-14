import type { Metadata } from "next";
import BoxScanner from "@/components/boxesPage/BoxScanner";
import { getDb } from "@/db/client";
import { listBoxIssueOrders } from "@/server/boxes";
import { requirePageUser } from "@/server/page-access";
import { todayIso } from "@/utils/isoDate";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Сканер боксів" };

/** Сканер боксів: видача й повернення. Власник, старший локації й виробництво (ТЗ 6.7). */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("boxes");
  if (user.role !== "owner" && user.role !== "location_lead" && user.role !== "production") {
    redirect("/boxes");
  }
  const orders = await listBoxIssueOrders(getDb(), user, todayIso());
  const requested = (await searchParams).order;
  const initialOrderId =
    typeof requested === "string" && orders.some((o) => o.id === requested) ? requested : null;
  return <BoxScanner orders={orders} initialOrderId={initialOrderId} />;
}
