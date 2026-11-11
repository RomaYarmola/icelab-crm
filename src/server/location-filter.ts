import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db/client";
import { requireUser } from "./auth";
import { buildLocationFilter, listActiveLocations, type LocationFilter } from "./locations";

/** Cookie з вибраною локацією (id). Немає cookie означає «усі локації». */
export const LOCATION_COOKIE = "icelab_location";

/** Рік: вибір пам'ятається між відкриттями застосунку. */
export const LOCATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Вибір локації для поточного запиту (запам'ятовується на час запиту). Власник, менеджер і
 * бухгалтер отримують вибір із cookie, роль з локацією свою локацію. Списки й звіти фільтруйте за
 * `selectedId` цього результату.
 */
export const getLocationFilter = cache(async (): Promise<LocationFilter> => {
  const user = await requireUser();
  // Роль з локацією вибору не має, тож база й cookie для неї не потрібні.
  if (user.locationId) return buildLocationFilter(user, [], null);

  const [options, store] = await Promise.all([listActiveLocations(getDb()), cookies()]);
  return buildLocationFilter(user, options, store.get(LOCATION_COOKIE)?.value);
});
