import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locations } from "@/db/schema";
import { buildLocationFilter, listActiveLocations, parseLocationChoice } from "@/server/locations";
import { createTestDb, type TestDb } from "../db/harness";

const KYIV = { id: "11111111-1111-4111-8111-111111111111", name: "Київ" };
const LVIV = { id: "22222222-2222-4222-8222-222222222222", name: "Львів" };
const OPTIONS = [KYIV, LVIV];

describe("buildLocationFilter: що бачить користувач у шапці", () => {
  it("власник, менеджер і бухгалтер без збереженого вибору бачать усі локації й можуть вибирати", () => {
    const filter = buildLocationFilter({ locationId: null, locationName: null }, OPTIONS, null);
    expect(filter).toEqual({
      isSelectable: true,
      options: OPTIONS,
      selectedId: null,
      label: "Усі локації",
    });
  });

  it("збережений вибір звужує перегляд до однієї локації", () => {
    const filter = buildLocationFilter({ locationId: null, locationName: null }, OPTIONS, LVIV.id);
    expect(filter.selectedId).toBe(LVIV.id);
    expect(filter.label).toBe("Львів");
    expect(filter.isSelectable).toBe(true);
  });

  it("невідоме значення (стара, чужа локація, сміття) вважається «усі»", () => {
    for (const saved of ["не-id", "33333333-3333-4333-8333-333333333333", "", undefined]) {
      const filter = buildLocationFilter({ locationId: null, locationName: null }, OPTIONS, saved);
      expect(filter.selectedId).toBeNull();
      expect(filter.label).toBe("Усі локації");
    }
  });

  it("роль з локацією завжди бачить свою, вибору немає, cookie ігнорується", () => {
    const filter = buildLocationFilter(
      { locationId: KYIV.id, locationName: "Київ" },
      OPTIONS,
      LVIV.id,
    );
    expect(filter).toEqual({
      isSelectable: false,
      options: [],
      selectedId: KYIV.id,
      label: "Київ",
    });
  });

  it("якщо активна лише одна локація, вибору немає", () => {
    const filter = buildLocationFilter({ locationId: null, locationName: null }, [KYIV], KYIV.id);
    expect(filter.isSelectable).toBe(false);
    expect(filter.selectedId).toBeNull();
  });
});

describe("parseLocationChoice: перевірка вибору з браузера", () => {
  it("приймає id активної локації й null («усі»)", () => {
    expect(parseLocationChoice(KYIV.id, OPTIONS)).toBe(KYIV.id);
    expect(parseLocationChoice(null, OPTIONS)).toBeNull();
  });

  it("відхиляє все інше", () => {
    for (const bad of [
      "33333333-3333-4333-8333-333333333333",
      "all",
      "",
      42,
      undefined,
      {},
      ["x"],
    ]) {
      expect(parseLocationChoice(bad, OPTIONS)).toBeUndefined();
    }
  });
});

describe("listActiveLocations", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("повертає лише активні локації за назвою", async () => {
    await db.insert(locations).values([
      { code: "lviv", name: "Львів" },
      { code: "kyiv", name: "Київ" },
      { code: "old", name: "Стара", isActive: false },
    ]);
    const result = await listActiveLocations(db);
    expect(result.map((row) => row.name)).toEqual(["Київ", "Львів"]);
  });
});
