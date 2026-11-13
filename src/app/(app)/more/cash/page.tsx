import type { Metadata } from "next";
import { recordCashEntryAction, reverseCashEntryAction } from "@/app/(app)/more/cash/actions";
import CashPageContent from "@/components/cashPage/CashPageContent";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { listCashDay } from "@/server/cash";
import { getLocationFilter } from "@/server/location-filter";
import { can, isBotOnly } from "@/server/permissions";
import { todayIso } from "@/utils/isoDate";
import { parseDayParam } from "@/utils/productionParams";

export const metadata: Metadata = { title: "Готівка" };

/**
 * Готівка за день і локацією. День беремо з адреси (`?date=`), локацію з вибору в шапці (старший
 * локації бачить лише свою: це робить `listCashDay`). Записують власник і старший локації, сторно
 * лише власник; менеджер і бухгалтер читають. Доступ до розділу закриває layout.
 */
export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const today = todayIso();
  const date = parseDayParam(await searchParams, today);
  const locationFilter = await getLocationFilter();

  const day = await listCashDay(getDb(), user, {
    date,
    locationId: locationFilter.selectedId ?? undefined,
  });

  return (
    <CashPageContent
      day={day}
      today={today}
      canRecord={can(user.role, "order_cash", "write") && !isBotOnly(user.role, "order_cash")}
      canReverse={can(user.role, "cash_reversal", "write")}
      actions={{ record: recordCashEntryAction, reverse: reverseCashEntryAction }}
    />
  );
}
