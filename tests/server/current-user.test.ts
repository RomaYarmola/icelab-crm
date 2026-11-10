import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "@/db/schema";
import { AuthError, resolveAppUser } from "@/server/current-user";
import { createTestDb, type TestDb } from "../db/harness";
import { makeLocation, makeProfile } from "../db/helpers";

describe("resolveAppUser: хто це", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let location: Awaited<ReturnType<typeof makeLocation>>;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    location = await makeLocation(db, "kyiv");
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  async function reasonOf(promise: Promise<unknown>) {
    try {
      await promise;
      return undefined;
    } catch (error) {
      return error instanceof AuthError ? error.reason : `інша помилка: ${String(error)}`;
    }
  }

  it("повертає ім'я, роль і локацію з профілю в базі, а e-mail з сесії", async () => {
    const profile = await makeProfile(db, {
      fullName: "Олена Ковальчук",
      role: "location_lead",
      locationId: location.id,
    });
    const user = await resolveAppUser(db, { sub: profile.id, email: "olena@example.com" });
    expect(user).toEqual({
      id: profile.id,
      email: "olena@example.com",
      fullName: "Олена Ковальчук",
      role: "location_lead",
      locationId: location.id,
      locationName: "kyiv",
    });
  });

  it("власник без локації: усі локації", async () => {
    const owner = await makeProfile(db, { role: "owner" });
    const user = await resolveAppUser(db, { sub: owner.id });
    expect(user).toMatchObject({
      role: "owner",
      locationId: null,
      locationName: null,
      email: null,
    });
  });

  it("відмовляє без сесії або з некоректним ідентифікатором", async () => {
    expect(await reasonOf(resolveAppUser(db, {}))).toBe("no_session");
    expect(await reasonOf(resolveAppUser(db, { sub: null }))).toBe("no_session");
    expect(await reasonOf(resolveAppUser(db, { sub: "це не uuid" }))).toBe("no_session");
  });

  it("відмовляє, якщо акаунт є, а профілю в базі немає", async () => {
    expect(await reasonOf(resolveAppUser(db, { sub: crypto.randomUUID() }))).toBe("no_profile");
  });

  it("відмовляє вимкненому користувачу, а після вмикання знову пускає", async () => {
    const profile = await makeProfile(db, { role: "manager" });
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.id, profile.id));
    expect(await reasonOf(resolveAppUser(db, { sub: profile.id }))).toBe("inactive");

    await db.update(profiles).set({ isActive: true }).where(eq(profiles.id, profile.id));
    expect(await reasonOf(resolveAppUser(db, { sub: profile.id }))).toBeUndefined();
  });

  it("не пускає водія у веб", async () => {
    const driver = await makeProfile(db, { role: "driver", locationId: location.id });
    expect(await reasonOf(resolveAppUser(db, { sub: driver.id }))).toBe("web_not_allowed");
  });

  it("зміна ролі діє одразу, без повторного входу (рішення D18)", async () => {
    const profile = await makeProfile(db, { role: "manager" });
    expect((await resolveAppUser(db, { sub: profile.id })).role).toBe("manager");
    await db.update(profiles).set({ role: "accountant" }).where(eq(profiles.id, profile.id));
    expect((await resolveAppUser(db, { sub: profile.id })).role).toBe("accountant");
  });
});
