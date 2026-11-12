import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { changePasswordAction } from "@/app/(app)/more/actions";
import {
  createUserAction,
  resetPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from "@/app/(app)/more/users/actions";
import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { createSupabaseAuthAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import type { AppUser } from "@/server/guards";
import { INITIAL_FORM_STATE, type FormState } from "@/utils/formState";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAuthUser, makeLocation, makeProfile } from "../db/helpers";

vi.mock("@/server/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAuthAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const GOOD_PASSWORD = "dobryi-parol-123";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("серверні дії користувачів і пароля", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let kyivId: string;
  let owner: AppUser;
  let manager: AppUser;
  const log = {
    created: [] as { id: string; email: string; password?: string }[],
    passwords: new Map<string, string>(),
    banned: new Map<string, boolean>(),
  };

  async function appUser(role: AppUser["role"], fullName: string): Promise<AppUser> {
    const profile = await makeProfile(db, { role, fullName });
    return {
      id: profile.id,
      email: null,
      fullName,
      role,
      locationId: null,
      locationName: null,
    };
  }

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    kyivId = (await makeLocation(db, "kyiv-actions")).id;
    owner = await appUser("owner", "Власник Єдиний");
    manager = await appUser("manager", "Менеджер Тест");
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(() => {
    log.created.length = 0;
    log.passwords.clear();
    log.banned.clear();
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    vi.mocked(requireUser).mockResolvedValue(owner);
    vi.mocked(createSupabaseAuthAdmin).mockReturnValue({
      async createUser({ email, password }) {
        const id = crypto.randomUUID();
        await makeAuthUser(db, id, email);
        log.created.push({ id, email, password });
        return { id };
      },
      async deleteUser(id) {
        await db.execute(sql`delete from auth.users where id = ${id}`);
      },
      async setPassword(id, password) {
        log.passwords.set(id, password);
      },
      async setBanned(id, banned) {
        log.banned.set(id, banned);
      },
    });
  });

  const run = (
    action: (previous: FormState, data: FormData) => Promise<FormState>,
    fields: Record<string, string>,
  ) => action(INITIAL_FORM_STATE, form(fields));

  describe("створення", () => {
    it("власник створює користувача: профіль у базі, потім перехід на його екран", async () => {
      await expect(
        run(createUserAction, {
          email: "Nova.Osoba@Example.com",
          fullName: "Нова Особа",
          role: "manager",
          locationId: "",
          phone: "",
          password: GOOD_PASSWORD,
        }),
      ).rejects.toMatchObject({
        digest: expect.stringMatching(/NEXT_REDIRECT.*\/more\/users\/.*created=1/),
      });

      expect(log.created).toHaveLength(1);
      expect(log.created[0]).toMatchObject({ email: "nova.osoba@example.com" });
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, log.created[0]!.id));
      expect(profile).toMatchObject({ fullName: "Нова Особа", role: "manager", isActive: true });
    });

    it("порожній пароль означає вхід лише через Google", async () => {
      await expect(
        run(createUserAction, {
          email: "google.only@example.com",
          fullName: "Лише Google",
          role: "accountant",
          locationId: "",
          phone: "",
          password: "",
        }),
      ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      expect(log.created[0]?.password).toBeUndefined();
    });

    it("помилка введення: повідомлення українською і введені значення, акаунт не створено", async () => {
      const state = await run(createUserAction, {
        email: "не-пошта",
        fullName: "Хтось",
        role: "manager",
        locationId: "",
        phone: "+380501112233",
        password: "",
      });
      expect(state.status).toBe("error");
      expect(state.message).toBe("Вкажіть коректний e-mail.");
      expect(state.values).toMatchObject({
        email: "не-пошта",
        fullName: "Хтось",
        phone: "+380501112233",
      });
      expect(JSON.stringify(state)).not.toContain("password");
      expect(log.created).toHaveLength(0);
    });

    it("роль зі своєю локацією без локації відхиляється", async () => {
      const state = await run(createUserAction, {
        email: "lead@example.com",
        fullName: "Старший",
        role: "location_lead",
        locationId: "",
        phone: "",
        password: "",
      });
      expect(state).toMatchObject({
        status: "error",
        message: "Для цієї ролі потрібно вибрати локацію.",
      });
      expect(log.created).toHaveLength(0);
    });

    it("не власнику відмовлено, акаунт не створюється", async () => {
      vi.mocked(requireUser).mockResolvedValue(manager);
      const state = await run(createUserAction, {
        email: "x@example.com",
        fullName: "Х",
        role: "manager",
        locationId: "",
        phone: "",
        password: "",
      });
      expect(state).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
      expect(log.created).toHaveLength(0);
    });
  });

  describe("зміна профілю", () => {
    it("власник змінює ім'я, роль і локацію", async () => {
      const target = await makeProfile(db, { fullName: "Було", role: "manager" });
      const state = await run(updateUserAction, {
        id: target.id,
        fullName: "Стало",
        role: "location_lead",
        locationId: kyivId,
        phone: "+380509998877",
      });
      expect(state).toMatchObject({ status: "success", message: "Зміни збережено." });
      const [row] = await db.select().from(profiles).where(eq(profiles.id, target.id));
      expect(row).toMatchObject({
        fullName: "Стало",
        role: "location_lead",
        locationId: kyivId,
        phone: "+380509998877",
      });
    });

    it("єдиного активного власника не можна перевести в іншу роль", async () => {
      const state = await run(updateUserAction, {
        id: owner.id,
        fullName: owner.fullName,
        role: "manager",
        locationId: "",
        phone: "",
      });
      expect(state).toMatchObject({
        status: "error",
        message: "У системі має лишатися хоча б один активний власник.",
      });
      const [row] = await db.select().from(profiles).where(eq(profiles.id, owner.id));
      expect(row?.role).toBe("owner");
    });

    it("некоректний ідентифікатор дає «не знайдено», а не помилку бази", async () => {
      const state = await run(updateUserAction, {
        id: "не-uuid",
        fullName: "Х",
        role: "manager",
        locationId: "",
        phone: "",
      });
      expect(state).toMatchObject({ status: "error", message: "Користувача не знайдено." });
    });
  });

  describe("вимкнення й вмикання", () => {
    it("власник вимикає і вмикає користувача; вхід у Supabase блокується і відновлюється", async () => {
      const target = await makeProfile(db, { fullName: "Тимчасовий", role: "manager" });

      const off = await run(setUserActiveAction, { id: target.id, active: "0" });
      expect(off).toMatchObject({ status: "success", message: "Користувача вимкнено." });
      expect(log.banned.get(target.id)).toBe(true);
      expect(
        (await db.select().from(profiles).where(eq(profiles.id, target.id)))[0]?.isActive,
      ).toBe(false);

      const on = await run(setUserActiveAction, { id: target.id, active: "1" });
      expect(on).toMatchObject({ status: "success", message: "Користувача увімкнено." });
      expect(log.banned.get(target.id)).toBe(false);
      expect(
        (await db.select().from(profiles).where(eq(profiles.id, target.id)))[0]?.isActive,
      ).toBe(true);
    });

    it("власник не може вимкнути себе", async () => {
      const state = await run(setUserActiveAction, { id: owner.id, active: "0" });
      expect(state).toMatchObject({
        status: "error",
        message: "Не можна вимкнути власний обліковий запис.",
      });
      expect(log.banned.size).toBe(0);
    });

    it("не власнику відмовлено", async () => {
      vi.mocked(requireUser).mockResolvedValue(manager);
      const state = await run(setUserActiveAction, { id: owner.id, active: "0" });
      expect(state).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
    });
  });

  describe("пароль іншого користувача", () => {
    it("власник задає новий пароль", async () => {
      const target = await makeProfile(db, { fullName: "Скидання", role: "manager" });
      const state = await run(resetPasswordAction, {
        id: target.id,
        password: GOOD_PASSWORD,
        confirm: GOOD_PASSWORD,
      });
      expect(state.status).toBe("success");
      expect(log.passwords.get(target.id)).toBe(GOOD_PASSWORD);
    });

    it("паролі мають збігатися, а короткий відхиляється; пароль не потрапляє у відповідь", async () => {
      const target = await makeProfile(db, { fullName: "Скидання 2", role: "manager" });
      const mismatch = await run(resetPasswordAction, {
        id: target.id,
        password: GOOD_PASSWORD,
        confirm: "інший-пароль-123",
      });
      expect(mismatch).toMatchObject({ status: "error", message: "Паролі не збігаються." });

      const short = await run(resetPasswordAction, {
        id: target.id,
        password: "short",
        confirm: "short",
      });
      expect(short.status).toBe("error");
      expect(short.message).toContain("щонайменше 10 символів");
      expect(JSON.stringify([mismatch, short])).not.toContain(GOOD_PASSWORD);
      expect(log.passwords.size).toBe(0);
    });

    it("не власнику відмовлено", async () => {
      vi.mocked(requireUser).mockResolvedValue(manager);
      const state = await run(resetPasswordAction, {
        id: owner.id,
        password: GOOD_PASSWORD,
        confirm: GOOD_PASSWORD,
      });
      expect(state).toMatchObject({ status: "error", message: "Недостатньо прав для цієї дії." });
      expect(log.passwords.size).toBe(0);
    });
  });

  describe("зміна власного пароля", () => {
    function supabaseWith(result: { error: { message?: string } | null }) {
      const calls: string[] = [];
      vi.mocked(createSupabaseServerClient).mockResolvedValue({
        auth: {
          async updateUser({ password }: { password: string }) {
            calls.push(password);
            return result;
          },
        },
      } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
      return calls;
    }

    it("користувач змінює пароль через власну сесію", async () => {
      const calls = supabaseWith({ error: null });
      const state = await run(changePasswordAction, {
        password: GOOD_PASSWORD,
        confirm: GOOD_PASSWORD,
      });
      expect(state).toMatchObject({ status: "success", message: "Пароль змінено." });
      expect(calls).toEqual([GOOD_PASSWORD]);
    });

    it("паролі мають збігатися, інакше Supabase не викликається", async () => {
      const calls = supabaseWith({ error: null });
      const state = await run(changePasswordAction, {
        password: GOOD_PASSWORD,
        confirm: "інший-пароль-123",
      });
      expect(state).toMatchObject({ status: "error", message: "Паролі не збігаються." });
      expect(calls).toHaveLength(0);
    });

    it("короткий пароль відхиляється, помилка Supabase показується українською без подробиць", async () => {
      const calls = supabaseWith({ error: { message: "internal details" } });
      const short = await run(changePasswordAction, { password: "short", confirm: "short" });
      expect(short.status).toBe("error");
      expect(calls).toHaveLength(0);

      const failed = await run(changePasswordAction, {
        password: GOOD_PASSWORD,
        confirm: GOOD_PASSWORD,
      });
      expect(failed).toMatchObject({
        status: "error",
        message: "Не вдалося змінити пароль. Спробуйте ще раз.",
      });
      expect(JSON.stringify(failed)).not.toContain("internal details");
    });
  });
});
