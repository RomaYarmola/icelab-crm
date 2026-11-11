import { asc, eq } from "drizzle-orm";
import { ALL_LOCATIONS_LABEL } from "@/constants/constants";
import { locations } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import type { AppUser } from "./guards";

/**
 * Вибір локації в шапці (рішення D38). Власник, менеджер і бухгалтер бачать обидві локації й можуть
 * звузити перегляд до однієї; роль з локацією (старший локації, виробництво) завжди бачить лише
 * свою, вибору в неї немає. Чисті функції без доступу до cookie і Next: їх легко перевірити.
 */

export type LocationOption = { id: string; name: string };

export type LocationFilter = {
  /** Чи може користувач міняти локацію (інакше в шапці просто підпис). */
  isSelectable: boolean;
  /** Активні локації для вибору (порожньо, якщо вибору немає). */
  options: LocationOption[];
  /**
   * За якою локацією фільтрувати списки і звіти: `null` означає «усі». Для ролі з локацією це її
   * локація. Саме це значення передавайте у запити, а не читайте cookie напряму.
   */
  selectedId: string | null;
  /** Підпис для шапки: назва вибраної локації або «Усі локації». */
  label: string;
};

/** Активні локації за назвою. */
export async function listActiveLocations(db: AnyPgDatabase): Promise<LocationOption[]> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));
}

/**
 * Збирає стан вибору локації для користувача. `savedId` це збережене значення (cookie): воно
 * лише звужує перегляд, тому перевіряється за списком активних локацій, а невідоме (стара або
 * чужа локація, сміття) тихо вважається «усі». Роль з локацією cookie ігнорує.
 */
export function buildLocationFilter(
  user: Pick<AppUser, "locationId" | "locationName">,
  options: LocationOption[],
  savedId: string | null | undefined,
): LocationFilter {
  if (user.locationId) {
    return {
      isSelectable: false,
      options: [],
      selectedId: user.locationId,
      label: user.locationName ?? ALL_LOCATIONS_LABEL,
    };
  }

  // Одна локація: вибирати нема з чого, «усі» і вона це те саме.
  if (options.length < 2) {
    return { isSelectable: false, options: [], selectedId: null, label: ALL_LOCATIONS_LABEL };
  }

  const selected = options.find((option) => option.id === savedId) ?? null;
  return {
    isSelectable: true,
    options,
    selectedId: selected?.id ?? null,
    label: selected?.name ?? ALL_LOCATIONS_LABEL,
  };
}

/**
 * Перевіряє вибір, що прийшов із браузера. Повертає id локації, `null` для «усі локації» або
 * `undefined`, якщо значення недійсне (тоді нічого не зберігаємо).
 */
export function parseLocationChoice(
  choice: unknown,
  options: LocationOption[],
): string | null | undefined {
  if (choice === null) return null;
  if (typeof choice !== "string") return undefined;
  return options.some((option) => option.id === choice) ? choice : undefined;
}
