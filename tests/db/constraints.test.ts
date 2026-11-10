import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAddresses,
  clientContacts,
  clientPrices,
  clients,
  defaultPrices,
  iceTypes,
  orderItems,
  orders,
  orderStatusHistory,
  profiles,
} from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import {
  CYRILLIC_PREFIX,
  LATIN_PREFIX,
  makeClient,
  makeLocation,
  makeOrder,
  makeProfile,
  pgErrorCode,
} from "./helpers";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
// ON DELETE RESTRICT у Postgres повертає restrict_violation (23001), а не foreign_key_violation (23503).
const RESTRICT_VIOLATION = "23001";

describe("обмеження цілісності", () => {
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

  describe("код клієнта", () => {
    it("відхиляє латиницю", async () => {
      const code = await pgErrorCode(
        db.insert(clients).values({ code: `${LATIN_PREFIX}21`, name: "Латиниця" }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("відхиляє малі літери, код без цифр і код без другої літери", async () => {
      for (const bad of ["аа21", `${CYRILLIC_PREFIX}`, "А21"]) {
        const code = await pgErrorCode(
          db.insert(clients).values({ code: bad, name: "Поганий код" }),
        );
        expect(code, bad).toBe(CHECK_VIOLATION);
      }
    });

    it("приймає кирилицю", async () => {
      const client = await makeClient(db, { code: `${CYRILLIC_PREFIX}777` });
      expect(client.code).toBe(`${CYRILLIC_PREFIX}777`);
    });

    it("приймає клієнта-заглушку з кодом 404", async () => {
      const client = await makeClient(db, {
        code: "404",
        name: "Новий клієнт",
        isPlaceholder: true,
      });
      expect(client.isPlaceholder).toBe(true);
    });

    it("не пускає клієнта з кодом 404, якщо це не заглушка", async () => {
      const code = await pgErrorCode(
        db.insert(clients).values({ code: "404", name: "Не заглушка" }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("код унікальний навіть серед видалених клієнтів", async () => {
      const client = await makeClient(db, { code: `${CYRILLIC_PREFIX}888` });
      await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));
      const code = await pgErrorCode(
        db.insert(clients).values({ code: `${CYRILLIC_PREFIX}888`, name: "Дубль" }),
      );
      expect(code).toBe(UNIQUE_VIOLATION);
    });
  });

  describe("телефони", () => {
    it("приймає формат E.164 і відхиляє інший", async () => {
      const client = await makeClient(db);
      await db.insert(clientContacts).values({ clientId: client.id, phone: "+380501234567" });
      const bad = await pgErrorCode(
        db.insert(clientContacts).values({ clientId: client.id, phone: "0501234567" }),
      );
      expect(bad).toBe(CHECK_VIOLATION);
    });

    it("перевіряє телефон отримувача в замовленні", async () => {
      const client = await makeClient(db);
      const bad = await pgErrorCode(
        db.insert(orders).values({
          clientId: client.id,
          locationId,
          orderDate: "2026-11-09",
          recipientPhone: "050-123",
        }),
      );
      expect(bad).toBe(CHECK_VIOLATION);
    });
  });

  describe("адреси клієнта", () => {
    it("дозволяє лише одну адресу за замовчуванням на клієнта", async () => {
      const first = await makeClient(db);
      const second = await makeClient(db);
      await db
        .insert(clientAddresses)
        .values({ clientId: first.id, kind: "delivery", isDefault: true });

      const duplicate = await pgErrorCode(
        db
          .insert(clientAddresses)
          .values({ clientId: first.id, kind: "np_warehouse", isDefault: true }),
      );
      expect(duplicate).toBe(UNIQUE_VIOLATION);

      // Звичайні адреси й адреса за замовчуванням іншого клієнта проходять.
      await db.insert(clientAddresses).values({ clientId: first.id, kind: "bus" });
      await db
        .insert(clientAddresses)
        .values({ clientId: second.id, kind: "delivery", isDefault: true });
    });
  });

  describe("ціни клієнта", () => {
    it("дозволяє лише одну поточну ціну на клієнта, тип льоду і ступінь обсягу", async () => {
      const client = await makeClient(db);
      const [ice] = await db.insert(iceTypes).values({ code: "ice_a", name: "A" }).returning();
      const base = { clientId: client.id, pricePerKg: "50", validFrom: "2026-01-01" };

      const [current] = await db
        .insert(clientPrices)
        .values({ ...base, minKg: "0" })
        .returning();

      // Така сама поточна ціна для «будь-якого типу» відхиляється (порожній тип теж враховано).
      expect(await pgErrorCode(db.insert(clientPrices).values({ ...base, minKg: "0" }))).toBe(
        UNIQUE_VIOLATION,
      );
      // Інший ступінь обсягу, конкретний тип льоду, закрита ціна проходять.
      await db.insert(clientPrices).values({ ...base, minKg: "100" });
      await db.insert(clientPrices).values({ ...base, iceTypeId: ice!.id, minKg: "0" });
      await db
        .insert(clientPrices)
        .values({ ...base, minKg: "0", validFrom: "2025-01-01", validTo: "2025-12-31" });

      // Зміна ціни: закрити стару і додати нову.
      await db
        .update(clientPrices)
        .set({ validTo: "2026-06-30" })
        .where(eq(clientPrices.id, current!.id));
      await db
        .insert(clientPrices)
        .values({ ...base, minKg: "0", pricePerKg: "55", validFrom: "2026-07-01" });
    });

    it("відхиляє період, де кінець раніше за початок, і від'ємні значення", async () => {
      const client = await makeClient(db);
      const base = { clientId: client.id, pricePerKg: "50", validFrom: "2026-05-01" };
      expect(
        await pgErrorCode(db.insert(clientPrices).values({ ...base, validTo: "2026-04-01" })),
      ).toBe(CHECK_VIOLATION);
      expect(await pgErrorCode(db.insert(clientPrices).values({ ...base, pricePerKg: "-1" }))).toBe(
        CHECK_VIOLATION,
      );
    });

    it("дозволяє лише одну поточну ціну за замовчуванням на тип льоду і ступінь", async () => {
      const [ice] = await db.insert(iceTypes).values({ code: "ice_b", name: "B" }).returning();
      const row = { iceTypeId: ice!.id, pricePerKg: "40", validFrom: "2026-01-01" };
      await db.insert(defaultPrices).values(row);
      expect(await pgErrorCode(db.insert(defaultPrices).values(row))).toBe(UNIQUE_VIOLATION);
    });
  });

  describe("видалення довідників", () => {
    it("заборонене, поки на запис є посилання", async () => {
      const [ice] = await db.insert(iceTypes).values({ code: "ice_c", name: "C" }).returning();
      await makeClient(db, { iceTypeId: ice!.id });
      expect(await pgErrorCode(db.delete(iceTypes).where(eq(iceTypes.id, ice!.id)))).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });

  describe("профілі", () => {
    it("вимагають локацію для старшого локації, виробництва і водія", async () => {
      for (const role of ["location_lead", "production", "driver"] as const) {
        const code = await pgErrorCode(
          db.insert(profiles).values({ id: crypto.randomUUID(), fullName: "Без локації", role }),
        );
        expect(code, role).toBe(CHECK_VIOLATION);
      }
      await makeProfile(db, { fullName: "З локацією", role: "production", locationId });
      await makeProfile(db, { fullName: "Власник", role: "owner" });
    });

    it("не існують без акаунта в auth.users, а акаунт з профілем видалити не можна", async () => {
      expect(
        await pgErrorCode(
          db
            .insert(profiles)
            .values({ id: crypto.randomUUID(), fullName: "Без акаунта", role: "owner" }),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);

      const profile = await makeProfile(db, { fullName: "З акаунтом", role: "owner" });
      expect(
        await pgErrorCode(db.execute(sql`delete from auth.users where id = ${profile.id}`)),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  describe("замовлення", () => {
    it("відхиляє від'ємні кілограми, кількість боксів і кількість у позиції", async () => {
      const client = await makeClient(db);
      const base = { clientId: client.id, locationId, orderDate: "2026-11-09" };
      expect(await pgErrorCode(db.insert(orders).values({ ...base, kgSold: "-1" }))).toBe(
        CHECK_VIOLATION,
      );
      expect(await pgErrorCode(db.insert(orders).values({ ...base, boxCount: -1 }))).toBe(
        CHECK_VIOLATION,
      );

      const order = await makeOrder(db, { clientId: client.id, locationId });
      const item = { orderId: order.id, kind: "ice" as const, title: "Лід" };
      expect(await pgErrorCode(db.insert(orderItems).values({ ...item, qty: "-1" }))).toBe(
        CHECK_VIOLATION,
      );
    });

    it("видалення замовлення прибирає його позиції й історію статусів", async () => {
      const client = await makeClient(db);
      const order = await makeOrder(db, { clientId: client.id, locationId });
      await db
        .insert(orderItems)
        .values({ orderId: order.id, kind: "ice", title: "Лід", qty: "1", price: "10" });

      await db.delete(orders).where(eq(orders.id, order.id));

      expect(await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))).toEqual(
        [],
      );
      expect(
        await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id)),
      ).toEqual([]);
    });

    it("нумерація: явні номери (імпорт) дозволені, дублі ні, лічильник можна перевести", async () => {
      const client = await makeClient(db);
      const base = { clientId: client.id, locationId };

      const imported = await makeOrder(db, { ...base, number: 5000 });
      expect(imported.number).toBe(5000);
      expect(
        await pgErrorCode(
          db.insert(orders).values({ ...base, orderDate: "2026-11-09", number: 5000 }),
        ),
      ).toBe(UNIQUE_VIOLATION);

      await db.execute(sql`alter table orders alter column number restart with 6000`);
      const next = await makeOrder(db, base);
      expect(next.number).toBe(6000);
    });
  });
});
