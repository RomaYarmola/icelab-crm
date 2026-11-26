import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReferenceData } from "@/db/seed";
import {
  boxTypes,
  clientApplications,
  clientStatuses,
  iceTypes,
  locations,
  settings,
  co2Norms,
} from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";

const EXPECTED_COUNTS = {
  locations: 2,
  co2_norms: 2,
  ice_types: 5,
  order_sources: 10,
  client_statuses: 5,
  client_applications: 7,
  box_types: 4,
  regions: 27,
  settings: 7,
};

describe("початкові дані довідників", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("додає всі довідники", async () => {
    expect(await seedReferenceData(db)).toEqual(EXPECTED_COUNTS);

    const locationCodes = (await db.select({ code: locations.code }).from(locations)).map(
      (r) => r.code,
    );
    expect(locationCodes.sort()).toEqual(["kyiv", "lviv"]);

    const ice = await db.select({ code: iceTypes.code }).from(iceTypes).orderBy(iceTypes.sort);
    expect(ice.map((r) => r.code)).toEqual(["2mm", "3mm", "16mm", "19mm", "block"]);

    const statuses = await db.select({ code: clientStatuses.code }).from(clientStatuses);
    expect(statuses.map((r) => r.code).sort()).toEqual([
      "active",
      "in_mind",
      "irrelevant",
      "paused",
      "warm",
    ]);

    const apps = await db.select({ name: clientApplications.name }).from(clientApplications);
    expect(apps.map((r) => r.name)).toContain("Важкий дим");
  });

  it("бокс клієнта не оборотний і належить клієнту", async () => {
    const [box] = await db.select().from(boxTypes).where(eq(boxTypes.code, "client_box"));
    expect(box).toMatchObject({ isClientOwned: true, isReturnable: false });
  });

  it("налаштування мають значення за замовчуванням із ТЗ", async () => {
    const rows = await db.select().from(settings);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey).toMatchObject({
      "box.reminder_days": 14,
      "np.default_empty_box_kg": 1,
      "client.inactive_days_default": 30,
      "payment.amount_tolerance_uah": 0,
      "payment.date_window_days": 14,
      "report.daily_time": "18:00",
    });
  });

  it("норми CO2 у новій базі: Київ 2,7 і Львів 2,5; видалену норму повторний запуск не множить", async () => {
    const rows = await db
      .select({ code: locations.code, norm: co2Norms.norm, from: co2Norms.validFrom })
      .from(co2Norms)
      .innerJoin(locations, eq(locations.id, co2Norms.locationId));
    expect(rows.sort((a, b) => a.code.localeCompare(b.code))).toEqual([
      { code: "kyiv", norm: "2.700", from: "2026-01-01" },
      { code: "lviv", norm: "2.500", from: "2026-01-01" },
    ]);
    // Власник замінив норму іншою датою: повторне заповнення нічого не додає.
    await db.update(co2Norms).set({ validFrom: "2026-11-01", norm: "3.000" });
    expect((await seedReferenceData(db)).co2_norms).toBe(0);
    expect(await db.select().from(co2Norms)).toHaveLength(2);
  });

  it("повторний запуск нічого не додає", async () => {
    const again = await seedReferenceData(db);
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });

  it("повторний запуск не перезаписує правок, зроблених у даних", async () => {
    await db.update(locations).set({ name: "Київ (змінено)" }).where(eq(locations.code, "kyiv"));
    await db.update(settings).set({ value: 99 }).where(eq(settings.key, "box.reminder_days"));

    await seedReferenceData(db);

    const [kyiv] = await db.select().from(locations).where(eq(locations.code, "kyiv"));
    const [reminder] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "box.reminder_days"));
    expect(kyiv!.name).toBe("Київ (змінено)");
    expect(reminder!.value).toBe(99);
  });
});
