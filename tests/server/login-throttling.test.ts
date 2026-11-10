import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginFailures } from "@/db/schema";
import { LOGIN_LIMITS } from "@/server/login-limiter";
import {
  lockedOutMessage,
  type PasswordAuthApi,
  SIGN_IN_MESSAGES,
  signInWithPassword,
} from "@/server/sign-in";
import { createTestDb, type TestDb } from "../db/harness";
import { makeProfile } from "../db/helpers";

const NOW = new Date("2026-11-09T12:00:00.000Z");

/** Підміна Supabase Auth: один акаунт, лічильник звернень, керований статус помилки. */
function fakeAuth(account: { id: string; email: string; password: string }) {
  const state = { calls: 0, errorStatus: 400 };
  const api: PasswordAuthApi = {
    async signInWithPassword({ email, password }) {
      state.calls += 1;
      if (email === account.email && password === account.password) {
        return { data: { user: { id: account.id, email: account.email } }, error: null };
      }
      return { data: { user: null }, error: { status: state.errorStatus } };
    },
    async signOut() {},
  };
  return { api, state };
}

describe("вхід за паролем з обмеженням спроб", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let account: { id: string; email: string; password: string };

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    const profile = await makeProfile(db, { role: "manager" });
    account = { id: profile.id, email: "user@example.com", password: "правильний-пароль" };
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(async () => {
    await db.delete(loginFailures);
  });

  const attempt = (
    api: PasswordAuthApi,
    password: string,
    ip: string | null = null,
    email = "user@example.com",
  ) => signInWithPassword(api, db, { email, password }, { ip, now: NOW });

  it("після 5 невдалих спроб вхід блокується, навіть з правильним паролем, і Supabase не викликається", async () => {
    const { api, state } = fakeAuth(account);
    for (let i = 0; i < LOGIN_LIMITS.maxFailuresPerEmail; i++) {
      expect(await attempt(api, "неправильний")).toEqual({
        ok: false,
        message: SIGN_IN_MESSAGES.invalid,
      });
    }
    expect(state.calls).toBe(5);

    const blocked = await attempt(api, account.password);
    expect(blocked).toEqual({ ok: false, message: lockedOutMessage(15) });
    expect(blocked).toMatchObject({ message: expect.stringContaining("15 хв") });
    expect(state.calls).toBe(5); // 6-ту спробу до Supabase не пропустили
  });

  it("4 невдалі спроби і вдала: вхід проходить і лічильник скидається", async () => {
    const { api } = fakeAuth(account);
    for (let i = 0; i < 4; i++) await attempt(api, "неправильний");

    const ok = await attempt(api, account.password);
    expect(ok).toMatchObject({ ok: true, user: { id: account.id } });
    expect(await db.select().from(loginFailures)).toHaveLength(0);

    // Після скидання знову є 5 спроб.
    for (let i = 0; i < 4; i++) await attempt(api, "неправильний");
    expect(await attempt(api, account.password)).toMatchObject({ ok: true });
  });

  it("невідомий e-mail рахується так само, як відомий: повідомлення не підказує, чи є акаунт", async () => {
    const { api } = fakeAuth(account);
    for (let i = 0; i < 5; i++) await attempt(api, "x", null, "nobody@example.com");
    const blocked = await attempt(api, "x", null, "nobody@example.com");
    expect(blocked).toEqual({ ok: false, message: lockedOutMessage(15) });

    // Реальний e-mail з тими самими даними заблокований тим самим текстом.
    for (let i = 0; i < 5; i++) await attempt(api, "x");
    expect(await attempt(api, "x")).toEqual(blocked);
  });

  it("e-mail зводиться до нижнього регістру: інший регістр не обходить обмеження", async () => {
    const { api } = fakeAuth(account);
    for (let i = 0; i < 5; i++) await attempt(api, "x", null, "  USER@Example.com ");
    expect(await attempt(api, account.password, null, "user@example.com")).toEqual({
      ok: false,
      message: lockedOutMessage(15),
    });
  });

  it("ліміт за адресою клієнта діє для будь-яких e-mail з цієї адреси", async () => {
    const { api } = fakeAuth(account);
    const ip = "203.0.113.7";
    for (let i = 0; i < LOGIN_LIMITS.maxFailuresPerIp; i++) {
      await attempt(api, "x", ip, `user${i}@example.com`);
    }
    expect(await attempt(api, account.password, ip)).toEqual({
      ok: false,
      message: lockedOutMessage(15),
    });
    // З іншої адреси той самий акаунт входить.
    expect(await attempt(api, account.password, "198.51.100.1")).toMatchObject({ ok: true });
  });

  it("відповідь 429 від Supabase і збої не рахуються як спроби підбору", async () => {
    const { api, state } = fakeAuth(account);
    state.errorStatus = 429;
    for (let i = 0; i < 10; i++) {
      expect(await attempt(api, "x")).toEqual({
        ok: false,
        message: SIGN_IN_MESSAGES.tooManyAttempts,
      });
    }
    state.errorStatus = 500;
    for (let i = 0; i < 10; i++) await attempt(api, "x");
    expect(await db.select().from(loginFailures)).toHaveLength(0);
    // Користувача це не заблокувало.
    state.errorStatus = 400;
    expect(await attempt(api, account.password)).toMatchObject({ ok: true });
  });

  it("некоректні дані не звертаються ні до бази лічильника, ні до Supabase", async () => {
    const { api, state } = fakeAuth(account);
    expect(await signInWithPassword(api, db, { email: "", password: "" }, { now: NOW })).toEqual({
      ok: false,
      message: SIGN_IN_MESSAGES.badInput,
    });
    expect(state.calls).toBe(0);
    expect(await db.select().from(loginFailures)).toHaveLength(0);
  });

  it("правильний пароль вимкненого користувача не рахується як невдала спроба підбору", async () => {
    const { api } = fakeAuth({ ...account, id: crypto.randomUUID() }); // акаунт без профілю
    for (let i = 0; i < 6; i++) {
      const result = await attempt(api, account.password);
      expect(result).toEqual({ ok: false, message: SIGN_IN_MESSAGES.noProfile });
    }
    expect(await db.select().from(loginFailures)).toHaveLength(0);
  });
});
