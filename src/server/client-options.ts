import { and, asc, eq, inArray } from "drizzle-orm";
import {
  boxTypes,
  clientApplications,
  clientStatuses,
  iceTypes,
  orderSources,
  profiles,
  regions,
} from "@/db/schema";
import { CLIENT_STATUSES } from "@/db/seed-data";
import type { AnyPgDatabase } from "@/db/types";
import { type AppUser, requirePermission } from "./guards";

/**
 * Значення для списків вибору на екранах клієнтів: області, довідники й менеджери. Лише назви й
 * ідентифікатори, без службових полів. Права: як на сам розділ «Клієнти» (читання).
 */

export type Option = { id: string; name: string };

export type ClientFormOptions = {
  regions: { prefix: string; name: string }[];
  iceTypes: Option[];
  applications: Option[];
  statuses: Option[];
  sources: Option[];
  boxTypes: Option[];
  /** Хто може бути менеджером клієнта: активні менеджери й власники. */
  managers: Option[];
};

/** Статуси в порядку з ТЗ («Активний» першим, «Неактуально» останнім), невідомі в кінці за назвою. */
function sortStatuses(rows: { id: string; name: string; code: string }[]): Option[] {
  const order = (code: string) => {
    const index = CLIENT_STATUSES.findIndex((status) => status.code === code);
    return index === -1 ? CLIENT_STATUSES.length : index;
  };
  return [...rows]
    .sort((a, b) => order(a.code) - order(b.code) || a.name.localeCompare(b.name, "uk"))
    .map(({ id, name }) => ({ id, name }));
}

export async function getClientFormOptions(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<ClientFormOptions> {
  requirePermission(actor, "clients", "read");

  const [regionRows, iceRows, applicationRows, statusRows, sourceRows, boxRows, managerRows] =
    await Promise.all([
      db
        .select({ prefix: regions.prefix, name: regions.name })
        .from(regions)
        .orderBy(asc(regions.sort), asc(regions.name)),
      db
        .select({ id: iceTypes.id, name: iceTypes.name })
        .from(iceTypes)
        .where(eq(iceTypes.isActive, true))
        .orderBy(asc(iceTypes.sort), asc(iceTypes.name)),
      db
        .select({ id: clientApplications.id, name: clientApplications.name })
        .from(clientApplications)
        .orderBy(asc(clientApplications.name)),
      db
        .select({ id: clientStatuses.id, name: clientStatuses.name, code: clientStatuses.code })
        .from(clientStatuses),
      db
        .select({ id: orderSources.id, name: orderSources.name })
        .from(orderSources)
        .where(eq(orderSources.isActive, true))
        .orderBy(asc(orderSources.name)),
      db
        .select({ id: boxTypes.id, name: boxTypes.name })
        .from(boxTypes)
        .where(eq(boxTypes.isActive, true))
        .orderBy(asc(boxTypes.sort), asc(boxTypes.name)),
      db
        .select({ id: profiles.id, name: profiles.fullName })
        .from(profiles)
        .where(and(eq(profiles.isActive, true), inArray(profiles.role, ["manager", "owner"])))
        .orderBy(asc(profiles.fullName)),
    ]);

  return {
    regions: regionRows,
    iceTypes: iceRows,
    applications: applicationRows,
    statuses: sortStatuses(statusRows),
    sources: sourceRows,
    boxTypes: boxRows,
    managers: managerRows,
  };
}
