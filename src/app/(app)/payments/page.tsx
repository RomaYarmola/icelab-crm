import type { Metadata } from "next";
import PaymentsContent from "@/components/paymentsPage/PaymentsContent";
import { getDb } from "@/db/client";
import { getMonobankStatus } from "@/server/monobank/status";
import { can } from "@/server/permissions";
import { requirePageUser } from "@/server/page-access";
import { syncMonobankAction } from "./actions";

export const metadata: Metadata = { title: "Оплати" };

/** Екран «Оплати»: власник і бухгалтер (B13). */
export default async function PaymentsPage() {
  const user = await requirePageUser("payments");
  const monobank = await getMonobankStatus(getDb(), user);
  return (
    <PaymentsContent
      monobank={monobank}
      canSync={can(user.role, "bank_payments", "write")}
      syncAction={syncMonobankAction}
    />
  );
}
