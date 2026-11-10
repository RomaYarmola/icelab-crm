import {
  type AccessKind,
  type Resource,
  type UserRole,
  can,
  canAccessLocation,
  isOwnLocationOnly,
} from "./permissions";

/** Користувач, який зараз працює із системою (профіль із бази). */
export type AppUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  /** `null` означає «усі локації» (власник, менеджер, бухгалтер). */
  locationId: string | null;
  locationName: string | null;
};

/** Користувач не має права на цю дію. */
export class ForbiddenError extends Error {
  constructor(message = "Недостатньо прав для цієї дії.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Вимагає, щоб роль була однією з перелічених. */
export function requireRole(user: AppUser, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) throw new ForbiddenError();
}

export type PermissionScope =
  /** Дія над одним записом: `recordLocationId` це `location_id` запису (`null`, якщо в запису його немає). */
  | { recordLocationId: string | null }
  /** Доступ до розділу загалом (список, екран): рядки далі обов'язково фільтруємо за `locationScope`. */
  | { anyLocation: true };

/**
 * Вимагає право за матрицею ТЗ. Для ролей, у яких дозвіл діє лише в межах своєї локації («св.»),
 * потрібно вказати, до чого він застосовується: до запису (`recordLocationId`) чи до розділу
 * загалом (`anyLocation`). Без цього виклик вважається помилкою програміста.
 */
export function requirePermission(
  user: AppUser,
  resource: Resource,
  kind: AccessKind,
  scope?: PermissionScope,
): void {
  if (!can(user.role, resource, kind)) throw new ForbiddenError();
  if (!isOwnLocationOnly(user.role, resource)) return;
  if (!scope) {
    throw new Error(
      `Для ролі «${user.role}» дозвіл на «${resource}» діє лише в межах локації: вкажіть recordLocationId або anyLocation.`,
    );
  }
  if ("recordLocationId" in scope) requireLocation(user, scope.recordLocationId);
}

/**
 * Локація, за якою треба фільтрувати списки: `null` означає «усі локації».
 * Для ролей з локацією (старший локації, виробництво, водій) це їхня локація.
 */
export function locationScope(user: Pick<AppUser, "locationId">): string | null {
  return user.locationId;
}

/** Вимагає доступ до локації запису (роль з локацією бачить лише свою). */
export function requireLocation(user: AppUser, recordLocationId: string | null): void {
  if (!canAccessLocation(user, recordLocationId)) throw new ForbiddenError();
}
