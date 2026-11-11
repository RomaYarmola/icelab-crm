import { cookies } from "next/headers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocationAction } from "@/app/(app)/location-actions";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import type { AppUser } from "@/server/guards";
import { LOCATION_COOKIE } from "@/server/location-filter";
import { createTestDb, type TestDb } from "../db/harness";
import { makeLocation } from "../db/helpers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

function appUser(locationId: string | null): AppUser {
  return {
    id: "u1",
    email: null,
    fullName: "Тест",
    role: locationId ? "location_lead" : "manager",
    locationId,
    locationName: null,
  };
}

describe("setLocationAction: збереження вибору локації", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let kyivId: string;
  const set = vi.fn();
  const del = vi.fn();

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    kyivId = (await makeLocation(db, "kyiv")).id;
    await makeLocation(db, "lviv");
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(() => {
    set.mockReset();
    del.mockReset();
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    vi.mocked(cookies).mockResolvedValue({ set, delete: del } as unknown as Awaited<
      ReturnType<typeof cookies>
    >);
  });

  it("менеджер зберігає id активної локації в cookie", async () => {
    vi.mocked(requireUser).mockResolvedValue(appUser(null));
    expect(await setLocationAction(kyivId)).toEqual({ ok: true });
    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, options] = set.mock.calls[0]!;
    expect(name).toBe(LOCATION_COOKIE);
    expect(value).toBe(kyivId);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("null («усі») прибирає cookie", async () => {
    vi.mocked(requireUser).mockResolvedValue(appUser(null));
    expect(await setLocationAction(null)).toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith(LOCATION_COOKIE);
    expect(set).not.toHaveBeenCalled();
  });

  it("недійсне значення відхиляється, cookie не змінюється", async () => {
    vi.mocked(requireUser).mockResolvedValue(appUser(null));
    for (const bad of ["all", "33333333-3333-4333-8333-333333333333", "", 5 as unknown as string]) {
      expect(await setLocationAction(bad)).toEqual({ ok: false });
    }
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("роль з локацією не може змінити локацію", async () => {
    vi.mocked(requireUser).mockResolvedValue(appUser(kyivId));
    expect(await setLocationAction(kyivId)).toEqual({ ok: false });
    expect(await setLocationAction(null)).toEqual({ ok: false });
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
