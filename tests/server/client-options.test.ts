import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { getClientFormOptions } from "@/server/client-options";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { type UserRole } from "@/server/permissions";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeProfile } from "../db/helpers";

describe("значення для списків вибору на екранах клієнтів", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    users = await makeAppUsers(db);
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("області, довідники й менеджери для форми", async () => {
    const options = await getClientFormOptions(db, users.manager);
    expect(options.regions).toHaveLength(27);
    expect(options.regions.slice(0, 3).map((region) => region.prefix)).toEqual(["АА", "АІ", "ВС"]);
    expect(options.iceTypes.length).toBeGreaterThan(0);
    expect(options.applications.length).toBeGreaterThan(0);
    expect(options.sources.length).toBeGreaterThan(0);
    expect(options.boxTypes.length).toBeGreaterThan(0);
  });

  it("статуси в порядку з ТЗ: «Активний» першим, «Неактуально» останнім", async () => {
    const { statuses } = await getClientFormOptions(db, users.owner);
    expect(statuses.map((status) => status.name)).toEqual([
      "Активний",
      "Підігрітий",
      "Має на увазі",
      "Пауза",
      "Неактуально",
    ]);
  });

  it("менеджери: лише активні менеджери й власники, без інших ролей", async () => {
    const off = await makeProfile(db, { role: "manager", fullName: "Вимкнений менеджер" });
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.id, off.id));
    const { managers } = await getClientFormOptions(db, users.owner);
    const names = managers.map((manager) => manager.name);
    expect(names).toContain("Тест manager");
    expect(names).toContain("Тест owner");
    expect(names).not.toContain("Вимкнений менеджер");
    expect(names).not.toContain("Тест accountant");
    expect(names).not.toContain("Тест location_lead");
  });

  it("відповідь містить лише назви й ідентифікатори", async () => {
    const options = await getClientFormOptions(db, users.owner);
    for (const list of [options.managers, options.iceTypes, options.statuses]) {
      for (const item of list) expect(Object.keys(item).sort()).toEqual(["id", "name"]);
    }
  });

  it("читають ролі з правом на клієнтів, виробництву відмовлено", async () => {
    for (const role of ["owner", "manager", "location_lead", "accountant"] as const) {
      await expect(getClientFormOptions(db, users[role])).resolves.toBeDefined();
    }
    for (const role of ["production", "driver"] as const) {
      await expect(getClientFormOptions(db, users[role])).rejects.toThrow(ForbiddenError);
    }
  });
});
