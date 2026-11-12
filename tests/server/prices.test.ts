import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, clientPrices, defaultPrices, iceTypes } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { type AppUser, ForbiddenError } from "@/server/guards";
import { USER_ROLES, type UserRole } from "@/server/permissions";
import {
  changeClientPrice,
  changeDefaultPrice,
  listClientPrices,
  listDefaultPrices,
  resolvePrice,
} from "@/server/prices";
import { createTestDb, type TestDb } from "../db/harness";
import { makeClient, makeLocation, makeProfile } from "../db/helpers";

describe("ціни клієнтів і прайс", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let users: Record<UserRole, AppUser>;
  let mm3: string;
  let mm16: string;

  async function appUser(role: UserRole, locationId: string | null): Promise<AppUser> {
    const profile = await makeProfile(db, { role, fullName: `Тест ${role}`, locationId });
    return {
      id: profile.id,
      email: null,
      fullName: profile.fullName,
      role,
      locationId,
      locationName: null,
    };
  }

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    const location = await makeLocation(db, "kyiv-prices");
    const bound = new Set<UserRole>(["location_lead", "production", "driver"]);
    users = {} as Record<UserRole, AppUser>;
    for (const role of USER_ROLES)
      users[role] = await appUser(role, bound.has(role) ? location.id : null);
    const [a, b] = await db
      .insert(iceTypes)
      .values([
        { code: "p3", name: "3 мм", sort: 1 },
        { code: "p16", name: "16 мм", sort: 2 },
      ])
      .returning();
    mm3 = a!.id;
    mm16 = b!.id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const open = (clientId: string, iceTypeId: string | null) =>
    db
      .select()
      .from(clientPrices)
      .where(
        and(
          eq(clientPrices.clientId, clientId),
          iceTypeId ? eq(clientPrices.iceTypeId, iceTypeId) : isNull(clientPrices.iceTypeId),
          isNull(clientPrices.validTo),
        ),
      );

  describe("зміна ціни клієнта «від дати» (D45)", () => {
    it("перша ціна додається, друга закриває першу днем перед новою датою", async () => {
      const client = await makeClient(db);
      const first = await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm16,
        pricePerKg: "60",
        validFrom: "2026-11-01",
      });
      expect(first).toMatchObject({ pricePerKg: "60.00", validFrom: "2026-11-01", validTo: null });

      const second = await changeClientPrice(db, users.owner, {
        clientId: client.id,
        iceTypeId: mm16,
        pricePerKg: "55,5",
        validFrom: "2026-11-15",
      });
      expect(second).toMatchObject({ pricePerKg: "55.50", validFrom: "2026-11-15", validTo: null });

      const history = await db
        .select()
        .from(clientPrices)
        .where(eq(clientPrices.clientId, client.id))
        .orderBy(clientPrices.validFrom);
      expect(history.map((r) => [r.pricePerKg, r.validFrom, r.validTo])).toEqual([
        ["60.00", "2026-11-01", "2026-11-14"],
        ["55.50", "2026-11-15", null],
      ]);
      expect(await open(client.id, mm16)).toHaveLength(1);
    });

    it("майбутня дата: поточна ціна діє до дня перед нею", async () => {
      const client = await makeClient(db);
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "50",
        validFrom: "2026-10-01",
      });
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "58",
        validFrom: "2027-01-01",
      });
      const history = await listClientPrices(db, users.manager, client.id);
      expect(history.map((r) => [r.pricePerKg, r.validFrom, r.validTo])).toEqual([
        ["58.00", "2027-01-01", null],
        ["50.00", "2026-10-01", "2026-12-31"],
      ]);
    });

    it("у той самий день ціну виправляють у тому самому рядку", async () => {
      const client = await makeClient(db);
      const created = await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "50",
        validFrom: "2026-11-10",
      });
      const fixed = await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "52",
        validFrom: "2026-11-10",
      });
      expect(fixed.id).toBe(created.id);
      expect(fixed.pricePerKg).toBe("52.00");
      expect(await listClientPrices(db, users.manager, client.id)).toHaveLength(1);
    });

    it("раніше початку чинної ціни, та сама ціна, некоректна ціна чи дата відхиляються", async () => {
      const client = await makeClient(db);
      const base = { clientId: client.id, iceTypeId: mm3 };
      await changeClientPrice(db, users.manager, {
        ...base,
        pricePerKg: "50",
        validFrom: "2026-11-10",
      });

      const bad: [string, Partial<{ pricePerKg: string; validFrom: string }>][] = [
        ["раніше початку", { pricePerKg: "60", validFrom: "2026-11-09" }],
        ["та сама ціна", { pricePerKg: "50.00", validFrom: "2026-11-20" }],
        ["нуль", { pricePerKg: "0", validFrom: "2026-11-20" }],
        ["текст", { pricePerKg: "дорого", validFrom: "2026-11-20" }],
        ["дата 30 лютого", { pricePerKg: "60", validFrom: "2026-02-30" }],
        ["порожня дата", { pricePerKg: "60", validFrom: "" }],
      ];
      for (const [name, override] of bad) {
        await expect(
          changeClientPrice(db, users.manager, {
            ...base,
            pricePerKg: "60",
            validFrom: "2026-11-20",
            ...override,
          }),
          name,
        ).rejects.toBeInstanceOf(ValidationError);
      }
      // Історія не змінилась.
      expect(await listClientPrices(db, users.manager, client.id)).toHaveLength(1);
    });

    it("історії за типами льоду і «для будь-якого типу» незалежні", async () => {
      const client = await makeClient(db);
      for (const [iceTypeId, price] of [
        [mm3, "50"],
        [mm16, "60"],
        [null, "70"],
      ] as const) {
        await changeClientPrice(db, users.manager, {
          clientId: client.id,
          iceTypeId,
          pricePerKg: price,
          validFrom: "2026-11-01",
        });
      }
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm16,
        pricePerKg: "65",
        validFrom: "2026-11-10",
      });
      expect((await open(client.id, mm3))[0]?.pricePerKg).toBe("50.00");
      expect((await open(client.id, mm16))[0]?.pricePerKg).toBe("65.00");
      expect((await open(client.id, null))[0]?.pricePerKg).toBe("70.00");
      expect(await listClientPrices(db, users.manager, client.id)).toHaveLength(4);
    });

    it("клієнта нема, видалений, тип льоду нема чи вимкнений: помилка", async () => {
      const deleted = await makeClient(db, { deletedAt: new Date() });
      const live = await makeClient(db);
      const input = { pricePerKg: "50", validFrom: "2026-11-10", iceTypeId: mm3 };

      await expect(
        changeClientPrice(db, users.manager, { ...input, clientId: crypto.randomUUID() }),
      ).rejects.toThrow("Клієнта не знайдено");
      await expect(
        changeClientPrice(db, users.manager, { ...input, clientId: deleted.id }),
      ).rejects.toThrow("видалено");
      await expect(
        changeClientPrice(db, users.manager, {
          ...input,
          clientId: live.id,
          iceTypeId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("Тип льоду не знайдено");
      await expect(
        changeClientPrice(db, users.manager, { ...input, clientId: "не-uuid" }),
      ).rejects.toBeInstanceOf(ValidationError);

      const [off] = await db
        .insert(iceTypes)
        .values({ code: "off", name: "Вимкнений", isActive: false })
        .returning();
      await expect(
        changeClientPrice(db, users.manager, { ...input, clientId: live.id, iceTypeId: off!.id }),
      ).rejects.toThrow("вимкнено");
    });

    it("змінюють лише власник і менеджер, решті відмовлено і нічого не записано", async () => {
      const client = await makeClient(db);
      for (const role of USER_ROLES) {
        const input = {
          clientId: client.id,
          iceTypeId: mm3,
          pricePerKg: "50",
          validFrom: "2026-11-01",
        };
        if (role === "owner" || role === "manager") continue;
        await expect(changeClientPrice(db, users[role], input), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      expect(
        await db.select().from(clientPrices).where(eq(clientPrices.clientId, client.id)),
      ).toHaveLength(0);
      await changeClientPrice(db, users.owner, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "50",
        validFrom: "2026-11-01",
      });
    });

    it("у журналі змін видно автора кожної зміни", async () => {
      const client = await makeClient(db);
      const created = await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "50",
        validFrom: "2026-11-01",
      });
      await changeClientPrice(db, users.owner, {
        clientId: client.id,
        iceTypeId: mm3,
        pricePerKg: "55",
        validFrom: "2026-11-10",
      });
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "client_prices"), eq(auditLog.rowId, created.id)))
        .orderBy(auditLog.at);
      expect(rows.map((r) => [r.action, r.actorId])).toEqual([
        ["insert", users.manager.id],
        ["update", users.owner.id],
      ]);
    });
  });

  describe("прайс (ціни за замовчуванням)", () => {
    it("власник додає ціну і змінює «від дати»", async () => {
      await changeDefaultPrice(db, users.owner, {
        iceTypeId: mm3,
        pricePerKg: "60",
        validFrom: "2026-11-01",
      });
      await changeDefaultPrice(db, users.owner, {
        iceTypeId: mm3,
        pricePerKg: "66",
        validFrom: "2026-12-01",
      });
      const rows = (await listDefaultPrices(db, users.owner)).filter((r) => r.iceTypeId === mm3);
      expect(rows.map((r) => [r.pricePerKg, r.validFrom, r.validTo])).toEqual([
        ["66.00", "2026-12-01", null],
        ["60.00", "2026-11-01", "2026-11-30"],
      ]);
      expect(rows[0]?.iceTypeName).toBe("3 мм");
    });

    it("змінює лише власник; менеджер і бухгалтер лише дивляться", async () => {
      for (const role of USER_ROLES) {
        if (role === "owner") continue;
        await expect(
          changeDefaultPrice(db, users[role], {
            iceTypeId: mm16,
            pricePerKg: "70",
            validFrom: "2026-11-01",
          }),
          role,
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      for (const role of ["manager", "accountant"] as const) {
        await expect(listDefaultPrices(db, users[role]), role).resolves.toBeInstanceOf(Array);
      }
    });

    it("старший локації, виробництво й водій прайсу не бачать", async () => {
      for (const role of ["location_lead", "production", "driver"] as const) {
        await expect(listDefaultPrices(db, users[role]), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });

    it("зміни прайсу у журналі з автором", async () => {
      const [row] = await db
        .select()
        .from(defaultPrices)
        .where(eq(defaultPrices.iceTypeId, mm3))
        .limit(1);
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "default_prices"), eq(auditLog.rowId, row!.id)));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.actorId === users.owner.id)).toBe(true);
    });
  });

  describe("історія цін клієнта: хто бачить", () => {
    it("власник, менеджер і бухгалтер бачать; старший локації, виробництво, водій ні", async () => {
      const client = await makeClient(db);
      for (const role of ["owner", "manager", "accountant"] as const) {
        await expect(listClientPrices(db, users[role], client.id), role).resolves.toBeInstanceOf(
          Array,
        );
      }
      for (const role of ["location_lead", "production", "driver"] as const) {
        await expect(listClientPrices(db, users[role], client.id), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });
  });

  describe("яка ціна діє (resolvePrice, D45)", () => {
    // Окремий тип льоду і прайс, щоб не залежати від інших тестів.
    let ice: string;
    beforeAll(async () => {
      const [row] = await db
        .insert(iceTypes)
        .values({ code: "rp", name: "Для вибору ціни", sort: 9 })
        .returning();
      ice = row!.id;
      await changeDefaultPrice(db, users.owner, {
        iceTypeId: ice,
        pricePerKg: "60",
        validFrom: "2026-01-01",
      });
      await changeDefaultPrice(db, users.owner, {
        iceTypeId: ice,
        pricePerKg: "70",
        validFrom: "2026-11-01",
      });
    });

    it("без індивідуальних цін береться прайс, чинний на дату", async () => {
      const client = await makeClient(db);
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2026-10-31" }),
      ).toMatchObject({
        source: "default",
        pricePerKg: "60.00",
      });
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2026-11-01" }),
      ).toMatchObject({
        source: "default",
        pricePerKg: "70.00",
      });
    });

    it("індивідуальна ціна на цей тип сильніша за «для будь-якого» і за прайс", async () => {
      const client = await makeClient(db);
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: null,
        pricePerKg: "55",
        validFrom: "2026-01-01",
      });
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: ice,
        pricePerKg: "50",
        validFrom: "2026-01-01",
      });
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2026-11-12" }),
      ).toMatchObject({
        source: "client",
        pricePerKg: "50.00",
      });
    });

    it("«для будь-якого типу» діє, коли на цей тип окремої ціни немає", async () => {
      const client = await makeClient(db);
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: null,
        pricePerKg: "55",
        validFrom: "2026-01-01",
      });
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2026-11-12" }),
      ).toMatchObject({
        source: "client_any_type",
        pricePerKg: "55.00",
      });
    });

    it("ціна береться на дату: до початку, у межах і після закінчення", async () => {
      const client = await makeClient(db);
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: ice,
        pricePerKg: "50",
        validFrom: "2026-03-01",
      });
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: ice,
        pricePerKg: "45",
        validFrom: "2026-06-01",
      });
      const at = (date: string) => resolvePrice(db, { clientId: client.id, iceTypeId: ice, date });

      // До першої індивідуальної ціни діє прайс.
      expect(await at("2026-02-28")).toMatchObject({ source: "default", pricePerKg: "60.00" });
      expect(await at("2026-03-01")).toMatchObject({ source: "client", pricePerKg: "50.00" });
      // Остання доба першої ціни і перша доба другої.
      expect(await at("2026-05-31")).toMatchObject({ pricePerKg: "50.00" });
      expect(await at("2026-06-01")).toMatchObject({ pricePerKg: "45.00" });
    });

    it("майбутня ціна ще не діє до своєї дати", async () => {
      const client = await makeClient(db);
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: ice,
        pricePerKg: "50",
        validFrom: "2026-01-01",
      });
      await changeClientPrice(db, users.manager, {
        clientId: client.id,
        iceTypeId: ice,
        pricePerKg: "80",
        validFrom: "2027-01-01",
      });
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2026-12-31" }),
      ).toMatchObject({ pricePerKg: "50.00" });
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: ice, date: "2027-01-01" }),
      ).toMatchObject({ pricePerKg: "80.00" });
    });

    it("якщо ціни немає ніде, повертає null", async () => {
      const client = await makeClient(db);
      const [bare] = await db
        .insert(iceTypes)
        .values({ code: "bare", name: "Без цін" })
        .returning();
      expect(
        await resolvePrice(db, { clientId: client.id, iceTypeId: bare!.id, date: "2026-11-12" }),
      ).toBeNull();
    });

    it("без дати береться сьогоднішня", async () => {
      const client = await makeClient(db);
      const result = await resolvePrice(db, { clientId: client.id, iceTypeId: ice });
      expect(result?.source).toBe("default");
    });
  });
});
