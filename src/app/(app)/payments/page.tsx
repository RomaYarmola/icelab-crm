import type { Metadata } from "next";
import PaymentsContent from "@/components/paymentsPage/PaymentsContent";
import { getDb } from "@/db/client";
import { getMonobankStatus } from "@/server/monobank/status";
import { countQueue, listQueue, listStatement } from "@/server/payment-views";
import { can } from "@/server/permissions";
import { requirePageUser } from "@/server/page-access";
import { parsePaymentParams } from "@/utils/paymentParams";
import {
  ignorePaymentAction,
  matchPaymentAction,
  restorePaymentAction,
  syncMonobankAction,
  unmatchPaymentAction,
} from "./actions";

export const metadata: Metadata = { title: "Оплати" };

/**
 * Екран «Оплати» (B13, ТЗ 6.10): черга «Нерозпізнані», «Виписка» і підключення банку. Власник і
 * бухгалтер; скасувати зіставлення може лише власник. Стан (вкладка, фільтри, сторінка) в адресі.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("payments");
  const params = parsePaymentParams(await searchParams);
  const db = getDb();
  const [queueCount, queue, statement, monobank] = await Promise.all([
    countQueue(db, user),
    params.tab === "queue" ? listQueue(db, user) : null,
    params.tab === "statement" ? listStatement(db, user, params) : null,
    params.tab === "bank" ? getMonobankStatus(db, user) : { hasToken: false, accounts: [] },
  ]);
  return (
    <PaymentsContent
      params={params}
      queueCount={queueCount}
      queue={queue}
      statement={statement}
      monobank={monobank}
      canSync={can(user.role, "bank_payments", "write")}
      canUnmatch={can(user.role, "cash_reversal", "write")}
      actions={{
        sync: syncMonobankAction,
        match: matchPaymentAction,
        ignore: ignorePaymentAction,
        restore: restorePaymentAction,
        unmatch: unmatchPaymentAction,
      }}
    />
  );
}
