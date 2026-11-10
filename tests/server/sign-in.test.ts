import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "@/db/schema";
import {
  isAuthFailure,
  messageForReason,
  type PasswordAuthApi,
  SIGN_IN_MESSAGES,
  signInWithPassword,
} from "@/server/sign-in";
import { createTestDb, type TestDb } from "../db/harness";
import { makeLocation, makeProfile } from "../db/helpers";

/** Підміна Supabase Auth: знає один акаунт, пам'ятає, скільки разів викликали signOut. */
function fakeAuth(account: { id: string; email: string; password: string } | null) {
  const state = { signOutCalls: 0, lastStatus: undefined as number | undefined };
  const api: PasswordAuthApi = {
    async signInWithPassword({ email, password }) {
      if (state.lastStatus) return { data: { user: null }, error: { status: state.lastStatus } };
      if (account && email === account.email && password === account.password) {
        return { data: { user: { id: account.id, email: account.email } }, error: null };
      }
      return { data: { user: null }, error: { status: 400 } };
    },
    async signOut() {
      state.signOutCalls += 1;
    },
  };
  return { api, state };
}

describe("вхід за e-mail і паролем", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let locationId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    locationId = (await makeLocation(db)).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const account = (id: string) => ({
    id,
    email: "user@example.com",
    password: "правильний-пароль",
  });

  it("успіх: повертає користувача з роллю і локацією", async () => {
    const profile = await makeProfile(db, { role: "production", locationId, fullName: "Іван" });
    const { api, state } = fakeAuth(account(profile.id));
    const result = await signInWithPassword(api, db, {
      email: "  USER@example.com ",
      password: "правильний-пароль",
    });
    expect(result).toMatchObject({
      ok: true,
      user: { id: profile.id, role: "production", fullName: "Іван" },
    });
    expect(state.signOutCalls).toBe(0);
  });

  it("невірний пароль і невідомий e-mail дають однакове повідомлення", async () => {
    const profile = await makeProfile(db, { role: "manager" });
    const { api } = fakeAuth(account(profile.id));
    const wrongPassword = await signInWithPassword(api, db, {
      email: "user@example.com",
      password: "інший",
    });
    const unknownEmail = await signInWithPassword(api, db, {
      email: "nobody@example.com",
      password: "x",
    });
    expect(wrongPassword).toEqual({ ok: false, message: SIGN_IN_MESSAGES.invalid });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("порожні й некоректні дані відхиляються до звернення до Supabase", async () => {
    const { api } = fakeAuth(null);
    for (const input of [
      {},
      { email: "", password: "" },
      { email: "не-пошта", password: "x" },
      null,
    ]) {
      expect(await signInWithPassword(api, db, input)).toEqual({
        ok: false,
        message: SIGN_IN_MESSAGES.badInput,
      });
    }
  });

  it("перевищення ліміту спроб (429) дає окреме повідомлення", async () => {
    const { api, state } = fakeAuth(null);
    state.lastStatus = 429;
    expect(await signInWithPassword(api, db, { email: "user@example.com", password: "x" })).toEqual(
      {
        ok: false,
        message: SIGN_IN_MESSAGES.tooManyAttempts,
      },
    );
  });

  it("вимкнений користувач: пароль підійшов, але сесію скасовано і вхід відхилено", async () => {
    const profile = await makeProfile(db, { role: "manager" });
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.id, profile.id));
    const { api, state } = fakeAuth(account(profile.id));
    const result = await signInWithPassword(api, db, {
      email: "user@example.com",
      password: "правильний-пароль",
    });
    expect(result).toEqual({ ok: false, message: SIGN_IN_MESSAGES.inactive });
    expect(state.signOutCalls).toBe(1);
  });

  it("водій: вхід у веб відхилено і сесію скасовано", async () => {
    const profile = await makeProfile(db, { role: "driver", locationId });
    const { api, state } = fakeAuth(account(profile.id));
    const result = await signInWithPassword(api, db, {
      email: "user@example.com",
      password: "правильний-пароль",
    });
    expect(result).toEqual({ ok: false, message: SIGN_IN_MESSAGES.webNotAllowed });
    expect(state.signOutCalls).toBe(1);
  });

  it("акаунт без профілю: вхід відхилено і сесію скасовано", async () => {
    const { api, state } = fakeAuth(account(crypto.randomUUID()));
    const result = await signInWithPassword(api, db, {
      email: "user@example.com",
      password: "правильний-пароль",
    });
    expect(result).toEqual({ ok: false, message: SIGN_IN_MESSAGES.noProfile });
    expect(state.signOutCalls).toBe(1);
  });
});

describe("причини відмови в адресі сторінки входу", () => {
  it("приймає лише відомі причини, довільний текст з адреси ігнорується", () => {
    expect(isAuthFailure("inactive")).toBe(true);
    expect(isAuthFailure("web_not_allowed")).toBe(true);
    expect(isAuthFailure("<script>alert(1)</script>")).toBe(false);
    expect(isAuthFailure("toString")).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });

  it("повертає повідомлення українською або undefined", () => {
    expect(messageForReason("inactive")).toBe(SIGN_IN_MESSAGES.inactive);
    expect(messageForReason("що завгодно")).toBeUndefined();
    expect(messageForReason(null)).toBeUndefined();
  });
});
