import { eq } from "drizzle-orm";
import { z } from "zod";
import { locations, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import type { AppUser } from "./guards";
import { canUseWeb } from "./permissions";

/** Чому користувача не пускаємо. */
export type AuthFailure =
  /** Немає дійсної сесії. */
  | "no_session"
  /** Акаунт у Supabase є, а профілю в нашій базі немає. */
  | "no_profile"
  /** Профіль вимкнено. */
  | "inactive"
  /** Роль не має входу у веб (водій). */
  | "web_not_allowed";

export class AuthError extends Error {
  readonly reason: AuthFailure;

  constructor(reason: AuthFailure) {
    super(`Доступ відхилено: ${reason}`);
    this.name = "AuthError";
    this.reason = reason;
  }
}

const uuid = z.uuid();

/**
 * Хто це: за ідентифікатором користувача з перевіреної сесії знаходить профіль у базі
 * і перевіряє, що його можна пустити у веб. Роль і локацію беремо з таблиці `profiles`
 * на кожен запит (рішення D18), тому зміна ролі чи вимкнення діють одразу.
 */
export async function resolveAppUser(
  db: AnyPgDatabase,
  claims: { sub?: string | null; email?: string | null },
): Promise<AppUser> {
  if (!claims.sub || !uuid.safeParse(claims.sub).success) throw new AuthError("no_session");

  const [row] = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      locationId: profiles.locationId,
      locationName: locations.name,
      isActive: profiles.isActive,
    })
    .from(profiles)
    .leftJoin(locations, eq(locations.id, profiles.locationId))
    .where(eq(profiles.id, claims.sub))
    .limit(1);

  if (!row) throw new AuthError("no_profile");
  if (!row.isActive) throw new AuthError("inactive");
  if (!canUseWeb(row.role)) throw new AuthError("web_not_allowed");

  return {
    id: row.id,
    email: claims.email ?? null,
    fullName: row.fullName,
    role: row.role,
    locationId: row.locationId,
    locationName: row.locationName,
  };
}
