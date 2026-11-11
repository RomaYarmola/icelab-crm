"use server";

import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { LOCATION_COOKIE, LOCATION_COOKIE_MAX_AGE } from "@/server/location-filter";
import { listActiveLocations, parseLocationChoice } from "@/server/locations";

export type SetLocationResult = { ok: boolean };

/**
 * Зберігає вибір локації в шапці: id локації або `null` («усі»). Лише для ролей без власної
 * локації; значення перевіряється за списком активних локацій. Cookie лише звужує перегляд, права
 * доступу від нього не залежать (їх перевіряє сервер за профілем).
 */
export async function setLocationAction(choice: string | null): Promise<SetLocationResult> {
  const user = await requireUser();
  if (user.locationId) return { ok: false };

  const parsed = parseLocationChoice(choice, await listActiveLocations(getDb()));
  if (parsed === undefined) return { ok: false };

  const store = await cookies();
  if (parsed === null) {
    store.delete(LOCATION_COOKIE);
  } else {
    store.set(LOCATION_COOKIE, parsed, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCATION_COOKIE_MAX_AGE,
    });
  }
  return { ok: true };
}
