import type { OrderStatus } from "@/constants/constants";
import type { AnyPgDatabase } from "@/db/types";
import { parseClientListParams } from "@/utils/clientListParams";
import { todayIso } from "@/utils/isoDate";
import { parseOrderListParams } from "@/utils/orderListParams";
import { parseDayParam } from "@/utils/productionParams";
import {
  exportCash,
  exportClients,
  exportEverything,
  exportOrders,
  type ExportFile,
} from "./export";
import type { AppUser } from "./guards";

/**
 * Запит на експорт з адреси (B8, D92): кнопка «Експорт у Excel» веде на `/api/export/<список>` з
 * тими самими параметрами, що й сторінка списку, а тут вони читаються тими самими функціями, тож
 * файл збігається з тим, що користувач бачить на екрані. Локацію з вибору в шапці передає викликач.
 */

export const EXPORT_LISTS = ["orders", "clients", "cash", "all"] as const;
export type ExportList = (typeof EXPORT_LISTS)[number];

export function isExportList(value: string): value is ExportList {
  return (EXPORT_LISTS as readonly string[]).includes(value);
}

type RawParams = Record<string, string | string[] | undefined>;

export async function runExport(
  db: AnyPgDatabase,
  actor: AppUser,
  list: ExportList,
  params: RawParams,
  locationId?: string,
): Promise<ExportFile> {
  switch (list) {
    case "orders": {
      const filters = parseOrderListParams(params, todayIso());
      return exportOrders(db, actor, {
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        statuses: filters.status ? [filters.status as OrderStatus] : undefined,
        managerId: filters.managerId || undefined,
        deliveryMethod: filters.deliveryMethod || undefined,
        locationId,
        search: filters.search || undefined,
      });
    }
    case "clients": {
      const filters = parseClientListParams(params);
      return exportClients(db, actor, {
        search: filters.search || undefined,
        statusId: filters.statusId || undefined,
        managerId: filters.managerId || undefined,
        applicationId: filters.applicationId || undefined,
        // Видалених бачить лише власник, як і на екрані.
        includeDeleted: filters.includeDeleted && actor.role === "owner",
      });
    }
    case "cash":
      return exportCash(db, actor, { date: parseDayParam(params, todayIso()), locationId });
    case "all":
      return exportEverything(db, actor);
  }
}
