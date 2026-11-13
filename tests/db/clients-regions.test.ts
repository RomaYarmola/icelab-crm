import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import {
  auditLog,
  clientAddresses,
  clientContacts,
  clients,
  defaultPrices,
  iceTypes,
  regions,
} from "@/db/schema";
import { seedReferenceData } from "@/db/seed";
import { REGIONS } from "@/db/seed-data";
import { createTestDb, type TestDb } from "./harness";
import { CYRILLIC_PREFIX, LATIN_PREFIX, makeClient, makeProfile, pgErrorCode } from "./helpers";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

describe("клієнти і області (міграція 0008)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    await seedReferenceData(db);
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  describe("код клієнта: літери й цифри або лише цифри (D24)", () => {
    it("приймає код з самих цифр для клієнта без області", async () => {
      expect((await makeClient(db, { code: "21" })).code).toBe("21");
      expect((await makeClient(db, { code: "1000" })).code).toBe("1000");
    });

    it("приймає літери кирилицею і число", async () => {
      expect((await makeClient(db, { code: `${CYRILLIC_PREFIX}16` })).code).toBe(
        `${CYRILLIC_PREFIX}16`,
      );
    });

    it("відхиляє латиницю, змішаний порядок і зайві символи", async () => {
      for (const code of [
        `${LATIN_PREFIX}16`,
        "16АА",
        "А16",
        "ААА16",
        "АА",
        "АА-16",
        "1 6",
        " 16",
        "",
      ]) {
        const result = await pgErrorCode(db.insert(clients).values({ code, name: "Поганий код" }));
        expect(result, code).toBe(CHECK_VIOLATION);
      }
    });

    it("код 404 зарезервований за клієнтом-заглушкою: цифровому клієнту його не дають", async () => {
      expect(
        await pgErrorCode(db.insert(clients).values({ code: "404", name: "Не заглушка" })),
      ).toBe(CHECK_VIOLATION);
      const placeholder = await makeClient(db, {
        code: "404",
        name: "Новий клієнт",
        isPlaceholder: true,
      });
      expect(placeholder.isPlaceholder).toBe(true);
    });

    it("цифровий код унікальний так само, як і з літерами", async () => {
      await makeClient(db, { code: "77" });
      expect(await pgErrorCode(db.insert(clients).values({ code: "77", name: "Дубль" }))).toBe(
        UNIQUE_VIOLATION,
      );
    });
  });

  describe("області", () => {
    it("у довіднику 27 областей із затвердженої карти", async () => {
      const rows = await db.select().from(regions);
      expect(rows).toHaveLength(27);
      expect(REGIONS).toHaveLength(27);
    });

    it("кожен префікс складається з двох кириличних літер (без латинських двійників)", async () => {
      const rows = await db.select({ prefix: regions.prefix }).from(regions);
      for (const { prefix } of rows) {
        expect(prefix, prefix).toMatch(/^[А-ЯІЇЄҐ]{2}$/);
      }
      // Кожен префікс годиться як початок коду клієнта.
      for (const { prefix } of rows) {
        const client = await makeClient(db, { code: `${prefix}9001`, name: `Перевірка ${prefix}` });
        expect(client.code).toBe(`${prefix}9001`);
        await db.delete(clients).where(eq(clients.id, client.id));
      }
    });

    it("префікси й порядок унікальні, Київ, Київська і Львівська області перші", async () => {
      const rows = await db.select().from(regions).orderBy(regions.sort);
      expect(new Set(rows.map((r) => r.prefix)).size).toBe(27);
      expect(new Set(rows.map((r) => r.sort)).size).toBe(27);
      expect(rows.slice(0, 3).map((r) => r.prefix)).toEqual(["АА", "АІ", "ВС"]);
    });

    it("ключові розшифровки з карти Романа (D24)", async () => {
      const byPrefix = Object.fromEntries(
        (await db.select().from(regions)).map((r) => [r.prefix, r.name]),
      );
      expect(byPrefix["АА"]).toContain("Київ");
      expect(byPrefix["АІ"]).toBe("Київська область");
      expect(byPrefix["ВС"]).toBe("Львівська область");
      expect(byPrefix["ВО"]).toBe("Тернопільська область");
      // ТЕ (Тернопіль зі старих таблиць) у списку немає: клієнти переходять на ВО.
      expect(byPrefix["ТЕ"]).toBeUndefined();
    });

    it("не приймає префікс латиницею чи з іншою кількістю літер", async () => {
      for (const prefix of [LATIN_PREFIX, "А", "ААА", "аа", "А1"]) {
        const result = await pgErrorCode(db.insert(regions).values({ prefix, name: "Хибна" }));
        expect(result, prefix).toBe(CHECK_VIOLATION);
      }
    });
  });

  describe("об'єднання клієнтів (merged_into_id)", () => {
    it("клієнта не можна об'єднати із самим собою", async () => {
      const client = await makeClient(db);
      const result = await pgErrorCode(
        db
          .update(clients)
          .set({ mergedIntoId: client.id, deletedAt: new Date() })
          .where(eq(clients.id, client.id)),
      );
      expect(result).toBe(CHECK_VIOLATION);
    });

    it("об'єднаний клієнт завжди прихований (deleted_at)", async () => {
      const main = await makeClient(db);
      const duplicate = await makeClient(db);
      const withoutDeletion = await pgErrorCode(
        db.update(clients).set({ mergedIntoId: main.id }).where(eq(clients.id, duplicate.id)),
      );
      expect(withoutDeletion).toBe(CHECK_VIOLATION);

      await db
        .update(clients)
        .set({ mergedIntoId: main.id, deletedAt: new Date() })
        .where(eq(clients.id, duplicate.id));
      const [row] = await db.select().from(clients).where(eq(clients.id, duplicate.id));
      expect(row?.mergedIntoId).toBe(main.id);
    });

    it("посилання на неіснуючого клієнта відхиляється", async () => {
      const client = await makeClient(db);
      const result = await pgErrorCode(
        db
          .update(clients)
          .set({ mergedIntoId: "00000000-0000-4000-8000-000000000000", deletedAt: new Date() })
          .where(eq(clients.id, client.id)),
      );
      expect(result).toBe("23503");
    });
  });

  describe("журнал змін прайсу, контактів і адрес", () => {
    const auditOf = (table: string, rowId: string) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, table), eq(auditLog.rowId, rowId)))
        .orderBy(auditLog.at, auditLog.action);

    it("зміни контакту пишуться з автором", async () => {
      const actor = await makeProfile(db, { fullName: "Менеджер журналу" });
      const client = await makeClient(db);
      const contact = await withActor(db, actor.id, async (tx) => {
        const [row] = await tx
          .insert(clientContacts)
          .values({ clientId: client.id, name: "Іван", phone: "+380501234567" })
          .returning();
        return row!;
      });
      await withActor(db, actor.id, (tx) =>
        tx
          .update(clientContacts)
          .set({ phone: "+380671112233" })
          .where(eq(clientContacts.id, contact.id)),
      );
      const rows = await auditOf("client_contacts", contact.id);
      expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
      expect(rows.every((r) => r.actorId === actor.id)).toBe(true);
    });

    it("зміни адреси пишуться", async () => {
      const client = await makeClient(db);
      const [address] = await db
        .insert(clientAddresses)
        .values({ clientId: client.id, kind: "delivery", addressText: "вул. Тестова, 1" })
        .returning();
      await db
        .update(clientAddresses)
        .set({ addressText: "вул. Нова, 2" })
        .where(eq(clientAddresses.id, address!.id));
      expect((await auditOf("client_addresses", address!.id)).map((r) => r.action)).toEqual([
        "insert",
        "update",
      ]);
    });

    it("зміни прайсу пишуться (хто й що змінив)", async () => {
      const actor = await makeProfile(db, { fullName: "Власник журналу", role: "owner" });
      const [ice] = await db
        .insert(iceTypes)
        .values({ code: "ice_audit", name: "Для журналу" })
        .returning();
      const price = await withActor(db, actor.id, async (tx) => {
        const [row] = await tx
          .insert(defaultPrices)
          .values({ iceTypeId: ice!.id, pricePerKg: "60", validFrom: "2026-11-12" })
          .returning();
        return row!;
      });
      await withActor(db, actor.id, (tx) =>
        tx
          .update(defaultPrices)
          .set({ validTo: "2026-11-30" })
          .where(eq(defaultPrices.id, price.id)),
      );
      const rows = await auditOf("default_prices", price.id);
      expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
      expect(rows[1]?.actorId).toBe(actor.id);
      expect(JSON.stringify(rows[1]?.diff)).toContain("valid_to");
    });
  });

  describe("індекси пошуку", () => {
    it("є індекси за початком коду, телефоном і ім'ям контакту, а також за назвою клієнта", async () => {
      const result = await db.execute(
        sql`select indexname from pg_indexes where schemaname = 'public' and tablename in ('clients', 'client_contacts')`,
      );
      const names = (result.rows as { indexname: string }[]).map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          "clients_code_pattern_idx",
          "clients_name_trgm_idx",
          "client_contacts_phone_trgm_idx",
          "client_contacts_name_trgm_idx",
        ]),
      );
    });

    it("пошук за частиною телефону й схожою назвою працює (pg_trgm)", async () => {
      const client = await makeClient(db, { name: "Кафе Вогник Тестове" });
      await db
        .insert(clientContacts)
        .values({ clientId: client.id, name: "Олена", phone: "+380509876543" });

      const byPhone = await db.execute(
        sql`select client_id from client_contacts where phone like ${"%876543"}`,
      );
      expect(byPhone.rows.length).toBeGreaterThan(0);

      const byTypo = await db.execute(
        sql`select id from clients where name % ${"Кафе Вогнік Тестове"} and id = ${client.id}`,
      );
      expect(byTypo.rows).toHaveLength(1);
    });
  });
});
