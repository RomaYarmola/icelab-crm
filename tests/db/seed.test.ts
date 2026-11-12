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
} from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";

const EXPECTED_COUNTS = {
  locations: 2,
  ice_types: 3,
  order_sources: 10,
  client_statuses: 5,
  client_applications: 7,
  box_types: 6,
  regions: 27,
  settings: 8,
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
    expect(ice.map((r) => r.code)).toEqual(["3mm", "16mm", "19mm"]);

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
      "markup.np_percent": 10,
      "box.reminder_days": 14,
      "client.inactive_days_default": 30,
      "payment.amount_tolerance_uah": 5,
      "payment.date_window_days": 14,
      "report.daily_time": "21:00",
    });
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
