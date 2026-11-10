import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "@/db/schema";
import {
  completeGoogleSignIn,
  type GoogleAuthApi,
  isAuthFailure,
  isLoginReason,
  messageForReason,
  SIGN_IN_MESSAGES,
} from "@/server/sign-in";
import { createTestDb, type TestDb } from "../db/harness";
import { makeLocation, makeProfile } from "../db/helpers";

/** Підміна Supabase Auth: обмін коду повертає користувача, якого задали в тесті. */
function fakeGoogleAuth(
  outcome:
    | { user: { id: string; email?: string } }
    | { error: true }
    | { throws: true }
    | { noUser: true },
) {
  const state = { exchanged: [] as string[], signOutCalls: 0 };
  const api: GoogleAuthApi = {
    async exchangeCodeForSession(code) {
      state.exchanged.push(code);
      if ("throws" in outcome) throw new Error("мережа недоступна");
      if ("error" in outcome) return { data: { user: null }, error: { message: "bad code" } };
      if ("noUser" in outcome) return { data: { user: null }, error: null };
      return { data: { user: outcome.user }, error: null };
    },
    async signOut() {
      state.signOutCalls += 1;
    },
  };
  return { api, state };
}

describe("вхід через Google", () => {
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

  const params = (
    overrides: Partial<{ code: string | null; providerError: string | null }> = {},
  ) => ({
    code: "one-time-code",
    providerError: null,
    ...overrides,
  });

  it("успіх: код обмінюється на сесію, повертається користувач з роллю і локацією", async () => {
    const profile = await makeProfile(db, { role: "location_lead", locationId, fullName: "Олена" });
    const { api, state } = fakeGoogleAuth({ user: { id: profile.id, email: "olena@gmail.com" } });

    const result = await completeGoogleSignIn(api, db, params());
    expect(result).toMatchObject({
      ok: true,
      user: { id: profile.id, email: "olena@gmail.com", role: "location_lead", fullName: "Олена" },
    });
    expect(state.exchanged).toEqual(["one-time-code"]);
    expect(state.signOutCalls).toBe(0);
  });

  it("помилка від Google або Supabase (наприклад, реєстрацію вимкнено), немає коду: без обміну", async () => {
    const { api, state } = fakeGoogleAuth({ user: { id: crypto.randomUUID() } });
    expect(await completeGoogleSignIn(api, db, params({ providerError: "access_denied" }))).toEqual(
      {
        ok: false,
        reason: "google_failed",
      },
    );
    expect(await completeGoogleSignIn(api, db, params({ code: null }))).toEqual({
      ok: false,
      reason: "google_failed",
    });
    expect(await completeGoogleSignIn(api, db, params({ code: "" }))).toEqual({
      ok: false,
      reason: "google_failed",
    });
    expect(state.exchanged).toEqual([]);
  });

  it("обмін коду не вдався (помилка, виняток, немає користувача): google_failed", async () => {
    for (const outcome of [{ error: true }, { throws: true }, { noUser: true }] as const) {
      const { api } = fakeGoogleAuth(outcome);
      expect(await completeGoogleSignIn(api, db, params())).toEqual({
        ok: false,
        reason: "google_failed",
      });
    }
  });

  it("Google-акаунт без профілю (сторонній Gmail): відмова і сесію скасовано", async () => {
    const { api, state } = fakeGoogleAuth({
      user: { id: crypto.randomUUID(), email: "stranger@gmail.com" },
    });
    expect(await completeGoogleSignIn(api, db, params())).toEqual({
      ok: false,
      reason: "no_profile",
    });
    expect(state.signOutCalls).toBe(1);
  });

  it("вимкнений користувач: відмова і сесію скасовано", async () => {
    const profile = await makeProfile(db, { role: "manager" });
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.id, profile.id));
    const { api, state } = fakeGoogleAuth({ user: { id: profile.id } });
    expect(await completeGoogleSignIn(api, db, params())).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(state.signOutCalls).toBe(1);
  });

  it("водій: вхід у веб відхилено і сесію скасовано", async () => {
    const profile = await makeProfile(db, { role: "driver", locationId });
    const { api, state } = fakeGoogleAuth({ user: { id: profile.id } });
    expect(await completeGoogleSignIn(api, db, params())).toEqual({
      ok: false,
      reason: "web_not_allowed",
    });
    expect(state.signOutCalls).toBe(1);
  });
});

describe("причини на сторінці входу", () => {
  it("google_failed відомий сторінці входу, але не є причиною для /auth/end-session", () => {
    expect(isLoginReason("google_failed")).toBe(true);
    expect(isAuthFailure("google_failed")).toBe(false);
    expect(isLoginReason("inactive")).toBe(true);
    expect(isLoginReason("<script>")).toBe(false);
    expect(isLoginReason("toString")).toBe(false);
  });

  it("повідомлення про помилку Google українською", () => {
    expect(messageForReason("google_failed")).toBe(SIGN_IN_MESSAGES.googleFailed);
    expect(SIGN_IN_MESSAGES.googleFailed).toContain("власника");
  });
});
