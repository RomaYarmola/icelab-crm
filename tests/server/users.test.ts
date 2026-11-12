import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, profiles } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { type AppUser, ForbiddenError } from "@/server/guards";
import {
  type AuthAdmin,
  changeOwnPassword,
  createUserAccount,
  getUser,
  listUsers,
  provisionUser,
  resetUserPassword,
  setUserActive,
  updateUserProfile,
} from "@/server/users";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAuthUser, makeLocation, makeProfile } from "../db/helpers";

const GOOD_PASSWORD = "dobryi-parol-123";

/** Підміна адміністративного API Supabase: акаунти лежать у тестовій таблиці auth.users. */
function fakeAdmin(db: TestDb, options: { skipAuthRow?: boolean } = {}) {
  const log = {
    created: [] as { id: string; email: string; password?: string }[],
    deleted: [] as string[],
    passwords: new Map<string, string>(),
    banned: new Map<string, boolean>(),
  };
  const admin: AuthAdmin = {
    async createUser({ email, password }) {
      const id = crypto.randomUUID();
      if (!options.skipAuthRow) await makeAuthUser(db, id, email);
      log.created.push({ id, email, password });
      return { id };
    },
    async deleteUser(id) {
      await db.execute(sql`delete from auth.users where id = ${id}`);
      log.deleted.push(id);
    },
    async setPassword(id, password) {
      log.passwords.set(id, password);
    },
    async setBanned(id, banned) {
      log.banned.set(id, banned);
    },
  };
  return { admin, log };
}

async function expectRejects(promise: Promise<unknown>, type: new (...args: never[]) => Error) {
  await expect(promise).rejects.toBeInstanceOf(type);
}

describe("керування користувачами", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let kyiv: Awaited<ReturnType<typeof makeLocation>>;
  let owner: AppUser;
  let manager: AppUser;

  async function appUser(
    role: AppUser["role"],
    locationId: string | null = null,
  ): Promise<AppUser> {
    const profile = await makeProfile(db, { role, locationId, fullName: `Тест ${role}` });
    return {
      id: profile.id,
      email: null,
      fullName: profile.fullName,
      role: profile.role,
      locationId: profile.locationId,
      locationName: null,
    };
  }

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    kyiv = await makeLocation(db, "kyiv");
    owner = await appUser("owner");
    manager = await appUser("manager");
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    email: "  New.User@Example.com ",
    password: GOOD_PASSWORD,
    fullName: "  Новий Користувач ",
    role: "manager" as const,
    ...overrides,
  });

  describe("створення", () => {
    it("власник створює акаунт і профіль; e-mail нормалізується, а дію записано в журнал з автором", async () => {
      const { admin, log } = fakeAdmin(db);
      const profile = await createUserAccount(
        { db, admin },
        owner,
        input({ phone: "+380501234567" }),
      );

      expect(log.created).toHaveLength(1);
      expect(log.created[0]).toMatchObject({
        email: "new.user@example.com",
        password: GOOD_PASSWORD,
      });
      expect(profile).toMatchObject({
        id: log.created[0]!.id,
        fullName: "Новий Користувач",
        role: "manager",
        locationId: null,
        phone: "+380501234567",
        isActive: true,
      });

      const journal = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "profiles"), eq(auditLog.rowId, profile.id)));
      expect(journal).toHaveLength(1);
      expect(journal[0]).toMatchObject({ action: "insert", actorId: owner.id });
    });

    it("створює користувача без пароля для входу лише через Google; вхід за паролем додається пізніше", async () => {
      const { admin, log } = fakeAdmin(db);
      const profile = await createUserAccount(
        { db, admin },
        owner,
        input({ email: "google.user@gmail.com", password: undefined }),
      );
      expect(log.created[0]).toMatchObject({ email: "google.user@gmail.com", password: undefined });
      expect(profile).toMatchObject({ role: "manager", isActive: true });

      // Короткий пароль, якщо його все ж задано, відхиляється так само, як і раніше.
      await expectRejects(
        createUserAccount({ db, admin }, owner, input({ email: "x@gmail.com", password: "short" })),
        ValidationError,
      );

      // Пізніше власник може задати пароль.
      await resetUserPassword({ db, admin }, owner, profile.id, "dobryi-parol-123");
      expect(log.passwords.get(profile.id)).toBe("dobryi-parol-123");
    });

    it("створює виробництво з локацією", async () => {
      const { admin } = fakeAdmin(db);
      const profile = await createUserAccount(
        { db, admin },
        owner,
        input({ email: "prod@example.com", role: "production", locationId: kyiv.id }),
      );
      expect(profile).toMatchObject({ role: "production", locationId: kyiv.id });
    });

    it("не власник не може створювати користувачів, і акаунт не створюється", async () => {
      const { admin, log } = fakeAdmin(db);
      await expectRejects(createUserAccount({ db, admin }, manager, input()), ForbiddenError);
      expect(log.created).toHaveLength(0);
    });

    it("відхиляє некоректні дані до звернення до Supabase", async () => {
      const { admin, log } = fakeAdmin(db);
      const deps = { db, admin };
      const bad: Record<string, unknown>[] = [
        { password: "short" },
        { password: "x".repeat(73) },
        { email: "не-пошта" },
        { fullName: "   " },
        { role: "суперкористувач" },
        { role: "production" }, // потрібна локація
        { role: "location_lead", locationId: null },
        { role: "manager", locationId: kyiv.id }, // для цієї ролі локація не вказується
        { role: "production", locationId: crypto.randomUUID() }, // локації не існує
        { role: "production", locationId: "не-uuid" },
      ];
      for (const overrides of bad) {
        await expectRejects(createUserAccount(deps, owner, input(overrides)), ValidationError);
      }
      expect(log.created).toHaveLength(0);
    });

    it("якщо профіль створити не вдалося, акаунт у Supabase скасовується", async () => {
      // Підміна повертає ідентифікатор, якого немає в auth.users: профіль порушить зовнішній ключ.
      const { admin, log } = fakeAdmin(db, { skipAuthRow: true });
      await expect(
        createUserAccount({ db, admin }, owner, input({ email: "ghost@example.com" })),
      ).rejects.toThrow();
      expect(log.deleted).toEqual([log.created[0]!.id]);
      const left = await db.select().from(profiles).where(eq(profiles.id, log.created[0]!.id));
      expect(left).toHaveLength(0);
    });

    it("provisionUser без автора (скрипт для першого власника) пише системну дію", async () => {
      const { admin } = fakeAdmin(db);
      const profile = await provisionUser(
        { db, admin },
        null,
        input({ email: "first@example.com", role: "owner" }),
      );
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "profiles"), eq(auditLog.rowId, profile.id)));
      expect(entry).toMatchObject({ action: "insert", actorId: null });
    });
  });

  describe("зміна профілю", () => {
    it("змінює ім'я, роль і локацію разом; результат має бути узгодженим", async () => {
      const { admin } = fakeAdmin(db);
      const created = await createUserAccount(
        { db, admin },
        owner,
        input({ email: "u1@example.com" }),
      );

      const updated = await updateUserProfile({ db, admin }, owner, created.id, {
        fullName: "Нове Ім'я",
        role: "production",
        locationId: kyiv.id,
      });
      expect(updated).toMatchObject({
        fullName: "Нове Ім'я",
        role: "production",
        locationId: kyiv.id,
      });

      // Назад у менеджери без явного скидання локації не можна: роль без локації.
      await expectRejects(
        updateUserProfile({ db, admin }, owner, created.id, { role: "manager" }),
        ValidationError,
      );
      const back = await updateUserProfile({ db, admin }, owner, created.id, {
        role: "manager",
        locationId: null,
      });
      expect(back).toMatchObject({ role: "manager", locationId: null });
    });

    it("не власник не може змінювати профілі; невідомий користувач дає помилку", async () => {
      const { admin } = fakeAdmin(db);
      await expectRejects(
        updateUserProfile({ db, admin }, manager, owner.id, { fullName: "Хакер" }),
        ForbiddenError,
      );
      await expectRejects(
        updateUserProfile({ db, admin }, owner, crypto.randomUUID(), { fullName: "Ніхто" }),
        ValidationError,
      );
    });

    it("не дає прибрати роль власника в останнього активного власника", async () => {
      const own = await createTestDb();
      try {
        const odb = own.db;
        const lonelyOwner = await makeProfile(odb, { role: "owner" });
        const actor: AppUser = {
          id: lonelyOwner.id,
          email: null,
          fullName: lonelyOwner.fullName,
          role: "owner",
          locationId: null,
          locationName: null,
        };
        const { admin } = fakeAdmin(odb);
        await expectRejects(
          updateUserProfile({ db: odb, admin }, actor, actor.id, { role: "manager" }),
          ValidationError,
        );

        // З другим активним власником це дозволено.
        await makeProfile(odb, { role: "owner" });
        const updated = await updateUserProfile({ db: odb, admin }, actor, actor.id, {
          role: "manager",
        });
        expect(updated.role).toBe("manager");
      } finally {
        await own.client.close();
      }
    });
  });

  describe("вимкнення й вмикання", () => {
    it("вимикає профіль і забороняє вхід у Supabase, а потім вмикає назад", async () => {
      const { admin, log } = fakeAdmin(db);
      const created = await createUserAccount(
        { db, admin },
        owner,
        input({ email: "u2@example.com" }),
      );

      const off = await setUserActive({ db, admin }, owner, created.id, false);
      expect(off.isActive).toBe(false);
      expect(log.banned.get(created.id)).toBe(true);

      const on = await setUserActive({ db, admin }, owner, created.id, true);
      expect(on.isActive).toBe(true);
      expect(log.banned.get(created.id)).toBe(false);
    });

    it("не дозволяє вимкнути себе і не власнику вимикати інших", async () => {
      const { admin } = fakeAdmin(db);
      await expectRejects(setUserActive({ db, admin }, owner, owner.id, false), ValidationError);
      await expectRejects(setUserActive({ db, admin }, manager, owner.id, false), ForbiddenError);
    });

    it("не дозволяє вимкнути останнього активного власника", async () => {
      const own = await createTestDb();
      try {
        const odb = own.db;
        const first = await makeProfile(odb, { role: "owner" });
        const second = await makeProfile(odb, { role: "owner" });
        const actor: AppUser = {
          id: first.id,
          email: null,
          fullName: first.fullName,
          role: "owner",
          locationId: null,
          locationName: null,
        };
        const { admin } = fakeAdmin(odb);
        // Другого власника вимкнути можна: перший лишається.
        await setUserActive({ db: odb, admin }, actor, second.id, false);
        // Тепер перший єдиний активний власник: ще одного вимкнути не вдасться, а себе тим більше.
        const third = await makeProfile(odb, { role: "manager" });
        await setUserActive({ db: odb, admin }, actor, third.id, false);
        await expectRejects(
          setUserActive({ db: odb, admin }, actor, first.id, false),
          ValidationError,
        );
      } finally {
        await own.client.close();
      }
    });
  });

  describe("пароль", () => {
    it("власник скидає пароль іншому користувачу", async () => {
      const { admin, log } = fakeAdmin(db);
      const created = await createUserAccount(
        { db, admin },
        owner,
        input({ email: "u3@example.com" }),
      );
      await resetUserPassword({ db, admin }, owner, created.id, "novyi-parol-456");
      expect(log.passwords.get(created.id)).toBe("novyi-parol-456");
    });

    it("відхиляє короткий пароль, невідомого користувача і не власника", async () => {
      const { admin, log } = fakeAdmin(db);
      await expectRejects(
        resetUserPassword({ db, admin }, owner, manager.id, "short"),
        ValidationError,
      );
      await expectRejects(
        resetUserPassword({ db, admin }, owner, crypto.randomUUID(), "novyi-parol-456"),
        ValidationError,
      );
      await expectRejects(
        resetUserPassword({ db, admin }, manager, owner.id, "novyi-parol-456"),
        ForbiddenError,
      );
      expect(log.passwords.size).toBe(0);
    });

    it("користувач змінює власний пароль: перевірка довжини й помилка Supabase", async () => {
      const calls: string[] = [];
      const ok = {
        async updateUser({ password }: { password: string }) {
          calls.push(password);
          return { error: null };
        },
      };
      await changeOwnPassword(ok, "mii-novyi-parol-1");
      expect(calls).toEqual(["mii-novyi-parol-1"]);

      await expectRejects(changeOwnPassword(ok, "short"), ValidationError);
      expect(calls).toHaveLength(1);

      const failing = { updateUser: async () => ({ error: { message: "щось пішло не так" } }) };
      await expectRejects(changeOwnPassword(failing, "mii-novyi-parol-1"), ValidationError);
    });
  });
  describe("список користувачів", () => {
    it("власник бачить профілі разом з e-mail, локацією і станом; активні першими, далі за іменем", async () => {
      const lviv = await makeLocation(db, "lviv-list");
      const active = await makeProfile(db, { fullName: "Яна Активна", role: "manager" });
      const lead = await makeProfile(db, {
        fullName: "Андрій Старший",
        role: "location_lead",
        locationId: lviv.id,
      });
      const off = await makeProfile(db, { fullName: "Анатолій Вимкнений", isActive: false });
      await db.execute(
        sql`update auth.users set email = 'yana@example.com' where id = ${active.id}`,
      );

      const list = await listUsers(db, owner);
      const byId = new Map(list.map((user) => [user.id, user]));

      expect(byId.get(active.id)).toMatchObject({
        email: "yana@example.com",
        fullName: "Яна Активна",
        role: "manager",
        locationId: null,
        locationName: null,
        isActive: true,
      });
      expect(byId.get(lead.id)).toMatchObject({
        role: "location_lead",
        locationId: lviv.id,
        locationName: "lviv-list",
      });
      expect(byId.get(off.id)?.isActive).toBe(false);

      // Активні спершу (за іменем), вимкнені в кінці.
      const firstInactive = list.findIndex((user) => !user.isActive);
      expect(firstInactive).toBeGreaterThan(0);
      expect(list.slice(firstInactive).every((user) => !user.isActive)).toBe(true);
      const activeNames = list.slice(0, firstInactive).map((user) => user.fullName);
      expect(activeNames).toEqual([...activeNames].sort((a, b) => a.localeCompare(b)));
    });

    it("не власнику список недоступний", async () => {
      await expectRejects(listUsers(db, manager), ForbiddenError);
    });

    it("getUser повертає одного користувача або null", async () => {
      const found = await getUser(db, owner, owner.id);
      expect(found).toMatchObject({ id: owner.id, role: "owner" });
      expect(await getUser(db, owner, crypto.randomUUID())).toBeNull();
      await expectRejects(getUser(db, manager, owner.id), ForbiddenError);
    });
  });
});
