import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/constants/constants";
import { withActor } from "@/db/actor";
import { userRole } from "@/db/schema/enums";
import { locations, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { isLocationBound, type UserRole } from "./permissions";

/**
 * Керування користувачами (лише власник). Працює з двома сховищами: акаунт у Supabase Auth
 * (e-mail і пароль) і профіль у нашій таблиці `profiles` (ім'я, роль, локація, чи активний).
 * Листів система не надсилає (рішення D17): пароль задає і скидає власник.
 *
 * Користувачів не видаляємо, а вимикаємо: на профіль посилаються історія замовлень і журнал змін.
 */

/** Те, що потрібно від адміністративного API Supabase Auth. Реальна реалізація: `lib/supabase/admin.ts`. */
export interface AuthAdmin {
  /** Без пароля акаунт можна створити для входу лише через Google (вхід за паролем тоді неможливий). */
  createUser(input: { email: string; password?: string }): Promise<{ id: string }>;
  deleteUser(id: string): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
  /** Заборона входу й оновлення сесії (для вимкнених користувачів). */
  setBanned(id: string, banned: boolean): Promise<void>;
}

export type UserDeps = { db: AnyPgDatabase; admin: AuthAdmin };

/**
 * Акаунти Supabase Auth: лише для читання e-mail (у нашій таблиці `profiles` його немає). Таблиця
 * описана тут, а не в `db/schema`, щоб міграції її не створювали: вона належить Supabase.
 */
const authUsers = pgSchema("auth").table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
});

/** Користувач для списку й форми редагування (профіль разом з e-mail акаунта). */
export type UserListItem = {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  locationId: string | null;
  locationName: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
};

function selectUsers(db: AnyPgDatabase) {
  return db
    .select({
      id: profiles.id,
      email: authUsers.email,
      fullName: profiles.fullName,
      role: profiles.role,
      locationId: profiles.locationId,
      locationName: locations.name,
      phone: profiles.phone,
      isActive: profiles.isActive,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .leftJoin(locations, eq(locations.id, profiles.locationId))
    .leftJoin(authUsers, eq(authUsers.id, profiles.id));
}

/** Список користувачів для власника: спершу активні, далі за іменем. */
export async function listUsers(db: AnyPgDatabase, actor: AppUser): Promise<UserListItem[]> {
  requirePermission(actor, "users", "read");
  return selectUsers(db).orderBy(desc(profiles.isActive), asc(profiles.fullName));
}

/** Один користувач для екрана редагування; `null`, якщо такого немає. */
export async function getUser(
  db: AnyPgDatabase,
  actor: AppUser,
  userId: string,
): Promise<UserListItem | null> {
  requirePermission(actor, "users", "read");
  const [row] = await selectUsers(db).where(eq(profiles.id, userId)).limit(1);
  return row ?? null;
}

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів.`)
  .max(72, "Пароль не може бути довшим за 72 символи.");

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Вкажіть коректний e-mail."));
const fullNameSchema = z.string().trim().min(1, "Вкажіть ім'я.").max(100, "Ім'я надто довге.");
const roleSchema = z.enum(userRole.enumValues, "Оберіть роль зі списку.");
const locationIdSchema = z.uuid("Некоректна локація.").nullable();
const phoneSchema = z.string().trim().max(30, "Телефон надто довгий.").nullable();

const createUserSchema = z.object({
  email: emailSchema,
  // Без пароля: користувач входитиме лише через Google. Вхід за паролем можна додати пізніше,
  // коли власник задасть пароль (`resetUserPassword`).
  password: passwordSchema.optional(),
  fullName: fullNameSchema,
  role: roleSchema,
  locationId: locationIdSchema.default(null),
  phone: phoneSchema.default(null),
});

const updateUserSchema = z
  .object({
    fullName: fullNameSchema,
    role: roleSchema,
    locationId: locationIdSchema,
    phone: phoneSchema,
  })
  .partial();

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

/** Роль і локація мають узгоджуватися: для старшого локації, виробництва й водія локація обов'язкова. */
function assertRoleLocation(role: UserRole, locationId: string | null) {
  if (isLocationBound(role) && !locationId) {
    throw new ValidationError("Для цієї ролі потрібно вибрати локацію.");
  }
  if (!isLocationBound(role) && locationId) {
    throw new ValidationError("Для цієї ролі локація не вказується: доступ до всіх локацій.");
  }
}

async function assertLocationExists(db: AnyPgDatabase, locationId: string | null) {
  if (!locationId) return;
  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!row) throw new ValidationError("Локацію не знайдено.");
}

async function loadProfile(db: AnyPgDatabase, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!row) throw new ValidationError("Користувача не знайдено.");
  return row;
}

/** У системі завжди має лишатися хоча б один активний власник. */
async function assertAnotherActiveOwner(db: AnyPgDatabase, exceptUserId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(profiles)
    .where(
      and(eq(profiles.role, "owner"), eq(profiles.isActive, true), ne(profiles.id, exceptUserId)),
    );
  if (!row || row.n === 0) {
    throw new ValidationError("У системі має лишатися хоча б один активний власник.");
  }
}

/**
 * Створює акаунт і профіль. Без перевірки прав: для скриптів (перший власник) і для
 * `createUserAccount`, який перевіряє права. `actorId = null` означає системну дію.
 * Якщо профіль створити не вдалося, акаунт у Supabase скасовується, щоб не лишався «порожній» акаунт.
 */
export async function provisionUser(
  deps: UserDeps,
  actorId: string | null,
  input: CreateUserInput,
) {
  const data = parseInput(createUserSchema, input);
  assertRoleLocation(data.role, data.locationId);
  await assertLocationExists(deps.db, data.locationId);

  const account = await deps.admin.createUser({ email: data.email, password: data.password });
  try {
    return await withActor(deps.db, actorId, async (tx) => {
      const [profile] = await tx
        .insert(profiles)
        .values({
          id: account.id,
          fullName: data.fullName,
          role: data.role,
          locationId: data.locationId,
          phone: data.phone,
        })
        .returning();
      return profile!;
    });
  } catch (error) {
    await deps.admin.deleteUser(account.id).catch(() => {
      console.error("users: не вдалося скасувати акаунт після невдалого створення профілю");
    });
    throw error;
  }
}

/** Власник створює користувача. */
export async function createUserAccount(deps: UserDeps, actor: AppUser, input: CreateUserInput) {
  requirePermission(actor, "users", "write");
  return provisionUser(deps, actor.id, input);
}

/** Власник змінює ім'я, роль, локацію або телефон. Результат (роль + локація) має бути узгодженим. */
export async function updateUserProfile(
  deps: UserDeps,
  actor: AppUser,
  userId: string,
  patch: UpdateUserInput,
) {
  requirePermission(actor, "users", "write");
  const changes = parseInput(updateUserSchema, patch);
  const current = await loadProfile(deps.db, userId);

  const role = changes.role ?? current.role;
  const locationId = changes.locationId !== undefined ? changes.locationId : current.locationId;
  assertRoleLocation(role, locationId);
  await assertLocationExists(deps.db, locationId);

  if (current.role === "owner" && role !== "owner" && current.isActive) {
    await assertAnotherActiveOwner(deps.db, userId);
  }

  return withActor(deps.db, actor.id, async (tx) => {
    const [updated] = await tx
      .update(profiles)
      .set({
        ...(changes.fullName !== undefined && { fullName: changes.fullName }),
        ...(changes.phone !== undefined && { phone: changes.phone }),
        role,
        locationId,
      })
      .where(eq(profiles.id, userId))
      .returning();
    return updated!;
  });
}

/** Вимикає або вмикає користувача: профіль у базі і заборона входу в Supabase. */
export async function setUserActive(
  deps: UserDeps,
  actor: AppUser,
  userId: string,
  active: boolean,
) {
  requirePermission(actor, "users", "write");
  const current = await loadProfile(deps.db, userId);

  if (!active) {
    if (userId === actor.id)
      throw new ValidationError("Не можна вимкнути власний обліковий запис.");
    if (current.role === "owner" && current.isActive) {
      await assertAnotherActiveOwner(deps.db, userId);
    }
  }

  const updated = await withActor(deps.db, actor.id, async (tx) => {
    const [row] = await tx
      .update(profiles)
      .set({ isActive: active })
      .where(eq(profiles.id, userId))
      .returning();
    return row!;
  });
  await deps.admin.setBanned(userId, !active);
  return updated;
}

/** Власник задає новий пароль іншому користувачу (листів немає, тож це єдиний спосіб скинути пароль). */
export async function resetUserPassword(
  deps: UserDeps,
  actor: AppUser,
  userId: string,
  newPassword: string,
) {
  requirePermission(actor, "users", "write");
  const password = parseInput(passwordSchema, newPassword);
  await loadProfile(deps.db, userId);
  await deps.admin.setPassword(userId, password);
}

/** Те, що потрібно від клієнта Supabase Auth для зміни власного пароля. */
export type OwnPasswordApi = {
  updateUser(attributes: { password: string }): Promise<{ error: { message?: string } | null }>;
};

/** Будь-який користувач змінює власний пароль (використовується сесія цього користувача). */
export async function changeOwnPassword(auth: OwnPasswordApi, newPassword: string) {
  const password = parseInput(passwordSchema, newPassword);
  const { error } = await auth.updateUser({ password });
  if (error) throw new ValidationError("Не вдалося змінити пароль. Спробуйте ще раз.");
}
