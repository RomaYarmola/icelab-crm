import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAddresses, clientContacts, clientPrices, clients, orders } from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { findForbiddenFields } from "@/server/dto";
import { listClients } from "@/server/clients";
import type { AppUser } from "@/server/guards";
import { createTestDb, type TestDb } from "../db/harness";
import { makeAppUsers, makeClient, makeLocation, makeOrder } from "../db/helpers";
import {
  addDemoClients,
  DEMO_CLIENTS,
  DEMO_PREFIX,
  removeDemoClients,
} from "../../scripts/_demo-clients";

describe("демонстраційні клієнти (D49)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let owner: AppUser;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
    owner = (await makeAppUsers(db)).owner;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const demoRows = () =>
    db
      .select()
      .from(clients)
      .where(like(clients.name, `${DEMO_PREFIX}%`));

  it("усі назви починаються з «Тест:», щоб їх можна було знайти й видалити", () => {
    expect(DEMO_CLIENTS.length).toBeGreaterThanOrEqual(15);
    for (const demo of DEMO_CLIENTS)
      expect(demo.name.startsWith(DEMO_PREFIX), demo.name).toBe(true);
    expect(new Set(DEMO_CLIENTS.map((demo) => demo.name)).size).toBe(DEMO_CLIENTS.length);
  });

  it("додає клієнтів з кодами за областями, контактами, адресами й цінами", async () => {
    await makeClient(db, { code: "АА9000", name: "Справжній клієнт" });
    const result = await addDemoClients(db, owner);
    expect(result).toEqual({ added: DEMO_CLIENTS.length, skipped: false });

    const rows = await demoRows();
    expect(rows).toHaveLength(DEMO_CLIENTS.length);
    expect(rows.some((row) => /^АА[0-9]+$/.test(row.code))).toBe(true);
    expect(rows.some((row) => /^ВС[0-9]+$/.test(row.code))).toBe(true);
    expect(rows.some((row) => /^[0-9]+$/.test(row.code))).toBe(true);
    // Нумерація продовжує справжні коди (АА9000), а не починається з АА1.
    for (const row of rows.filter((item) => item.code.startsWith("АА"))) {
      expect(Number(row.code.slice(2)), row.code).toBeGreaterThan(9000);
    }
    expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);

    expect((await db.select().from(clientContacts)).length).toBeGreaterThan(10);
    expect((await db.select().from(clientAddresses)).length).toBeGreaterThan(3);
    expect((await db.select().from(clientPrices)).length).toBeGreaterThan(3);
  });

  it("є навмисний дубль з тим самим телефоном (для перевірки підказки й об'єднання)", async () => {
    const duplicates = (await demoRows()).filter((row) => row.name.includes("Вогн"));
    expect(duplicates.length).toBe(2);
  });

  it("повторний запуск нічого не додає", async () => {
    const before = (await demoRows()).length;
    expect(await addDemoClients(db, owner)).toEqual({ added: 0, skipped: true });
    expect((await demoRows()).length).toBe(before);
  });

  it("менеджер бачить клієнтів у списку, ціни до списку не потрапляють", async () => {
    const page = await listClients(db, owner, { search: "Тест:" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(findForbiddenFields(page.items, "manager")).toEqual([]);
  });

  it("--remove видаляє лише «Тест:», разом з контактами, адресами й цінами", async () => {
    const real = (await db.select().from(clients).where(eq(clients.name, "Справжній клієнт")))[0]!;
    const result = await removeDemoClients(db);
    expect(result).toEqual({ removed: DEMO_CLIENTS.length, kept: 0 });
    expect(await demoRows()).toHaveLength(0);
    expect((await db.select().from(clients).where(eq(clients.id, real.id))).length).toBe(1);
    expect(await db.select().from(clientContacts)).toHaveLength(0);
    expect(await db.select().from(clientAddresses)).toHaveLength(0);
    expect(await db.select().from(clientPrices)).toHaveLength(0);
  });

  it("після видалення можна додати знову, а об'єднаний дубль не заважає видаленню", async () => {
    await addDemoClients(db, owner);
    const [main, duplicate] = (await demoRows()).filter((row) => row.name.includes("Вогн"));
    await db
      .update(clients)
      .set({ mergedIntoId: main!.id, deletedAt: new Date() })
      .where(eq(clients.id, duplicate!.id));
    const result = await removeDemoClients(db);
    expect(result.kept).toBe(0);
    expect(await demoRows()).toHaveLength(0);
  });

  it("--bulk додає ще 35 клієнтів для перевірки «Показати ще»", async () => {
    const result = await addDemoClients(db, owner, { bulk: true });
    expect(result.added).toBe(DEMO_CLIENTS.length + 35);
    const page = await listClients(db, owner, { search: "Тест:" });
    expect(page.hasMore).toBe(true);
    await removeDemoClients(db);
  });

  it("клієнта із замовленням не видаляє, а рахує в «лишилось»", async () => {
    await addDemoClients(db, owner);
    const target = (await demoRows())[0]!;
    const location = await makeLocation(db);
    await makeOrder(db, { clientId: target.id, locationId: location.id });
    const result = await removeDemoClients(db);
    expect(result).toEqual({ removed: DEMO_CLIENTS.length - 1, kept: 1 });
    expect((await demoRows()).map((row) => row.id)).toEqual([target.id]);
    await db.delete(orders);
    await removeDemoClients(db);
    expect(await demoRows()).toHaveLength(0);
  });
});
