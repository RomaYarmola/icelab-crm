import type { Metadata } from "next";
import AnalyticsContent from "@/components/analyticsPage/AnalyticsContent";
import AnalyticsShell from "@/components/analyticsPage/AnalyticsShell";
import BoxesContent from "@/components/analyticsPage/BoxesContent";
import DeliveryContent from "@/components/analyticsPage/DeliveryContent";
import InactiveContent from "@/components/analyticsPage/InactiveContent";
import RemindersContent from "@/components/analyticsPage/RemindersContent";
import { getDb } from "@/db/client";
import { getAnalytics } from "@/server/analytics";
import { getBoxAnalytics, getDeliveryAnalytics } from "@/server/analytics-sales";
import { listInactiveClients, loadInactiveDays } from "@/server/inactive";
import { getLocationFilter } from "@/server/location-filter";
import { requirePageUser } from "@/server/page-access";
import { listReminders, loadBoxReminderDays, loadReturnReminderDays } from "@/server/reminders";
import { can, seesOwnClientsOnly } from "@/server/permissions";
import { parseAnalyticsParams, parseAnalyticsTab } from "@/utils/analyticsParams";
import { todayIso } from "@/utils/isoDate";
import {
  dismissReminderAction,
  markOneTimeAction,
  saveBoxDaysAction,
  saveReturnDaysAction,
  saveInactiveDaysAction,
} from "./actions";

export const metadata: Metadata = { title: "Аналітика" };

/**
 * Аналітика (B14, ТЗ 6.11): вкладки «Панель», «Бокси», «Доставки», «Давно не замовляли». Вкладка й
 * період в адресі, локація з вибору в шапці (список «Давно не замовляли» від них не залежить).
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("analytics");
  const raw = await searchParams;
  const tab = parseAnalyticsTab(raw.tab);
  const period = parseAnalyticsParams(raw, todayIso());
  const location = await getLocationFilter();
  const db = getDb();
  const query = { ...period, locationId: location.selectedId };
  const myReminders = await listReminders(db, user);
  return (
    <AnalyticsShell tab={tab} from={period.from} to={period.to} reminderCount={myReminders.length}>
      {tab === "reminders" ? (
        <RemindersContent
          reminders={myReminders}
          boxDays={await loadBoxReminderDays(db)}
          boxDaysAction={can(user.role, "migration_settings", "write") ? saveBoxDaysAction : null}
          returnDays={await loadReturnReminderDays(db)}
          returnDaysAction={
            can(user.role, "migration_settings", "write") ? saveReturnDaysAction : null
          }
          dismissAction={dismissReminderAction}
        />
      ) : tab === "inactive" ? (
        <InactiveContent
          clients={await listInactiveClients(db, user)}
          generalDays={await loadInactiveDays(db)}
          ownOnly={seesOwnClientsOnly(user)}
          canMark={can(user.role, "clients", "write")}
          thresholdAction={
            can(user.role, "migration_settings", "write") ? saveInactiveDaysAction : null
          }
          markAction={markOneTimeAction}
        />
      ) : tab === "boxes" ? (
        <BoxesContent data={await getBoxAnalytics(db, user, query)} />
      ) : tab === "delivery" ? (
        <DeliveryContent data={await getDeliveryAnalytics(db, user, query)} />
      ) : (
        <AnalyticsContent data={await getAnalytics(db, user, query)} />
      )}
    </AnalyticsShell>
  );
}
