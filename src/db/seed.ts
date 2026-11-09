import {
  boxTypes,
  clientApplications,
  clientStatuses,
  iceTypes,
  locations,
  orderSources,
  settings,
} from "@/db/schema";
import {
  BOX_TYPES,
  CLIENT_APPLICATIONS,
  CLIENT_STATUSES,
  ICE_TYPES,
  LOCATIONS,
  ORDER_SOURCES,
  SETTINGS,
} from "./seed-data";
import type { AnyPgDatabase } from "./types";

export type SeedResult = Record<string, number>;

/**
 * Додає відсутні початкові дані довідників. Ідемпотентно: наявні рядки (за `code` або
 * `key`) не змінюються, тож правки, зроблені в налаштуваннях, повторний запуск не перезапише.
 * Повертає, скільки нових рядків додано в кожну таблицю.
 */
export async function seedReferenceData(db: AnyPgDatabase): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const added: SeedResult = {};

    added.locations = (
      await tx
        .insert(locations)
        .values(LOCATIONS)
        .onConflictDoNothing({ target: locations.code })
        .returning({ id: locations.id })
    ).length;

    added.ice_types = (
      await tx
        .insert(iceTypes)
        .values(ICE_TYPES)
        .onConflictDoNothing({ target: iceTypes.code })
        .returning({ id: iceTypes.id })
    ).length;

    added.order_sources = (
      await tx
        .insert(orderSources)
        .values(ORDER_SOURCES)
        .onConflictDoNothing({ target: orderSources.code })
        .returning({ id: orderSources.id })
    ).length;

    added.client_statuses = (
      await tx
        .insert(clientStatuses)
        .values(CLIENT_STATUSES)
        .onConflictDoNothing({ target: clientStatuses.code })
        .returning({ id: clientStatuses.id })
    ).length;

    added.client_applications = (
      await tx
        .insert(clientApplications)
        .values(CLIENT_APPLICATIONS)
        .onConflictDoNothing({ target: clientApplications.code })
        .returning({ id: clientApplications.id })
    ).length;

    added.box_types = (
      await tx
        .insert(boxTypes)
        .values(BOX_TYPES)
        .onConflictDoNothing({ target: boxTypes.code })
        .returning({ id: boxTypes.id })
    ).length;

    added.settings = (
      await tx
        .insert(settings)
        .values(SETTINGS)
        .onConflictDoNothing({ target: settings.key })
        .returning({ key: settings.key })
    ).length;

    return added;
  });
}
