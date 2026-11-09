import { randomUUID } from "node:crypto";
import { clients, locations, orders, profiles } from "@/db/schema";
import type { TestDb } from "./harness";

/** Код клієнта кирилицею: «АА» (U+0410 U+0410) і число. Латинська «AA» тут не підходить. */
export const CYRILLIC_PREFIX = "АА";
export const LATIN_PREFIX = "AA";

let counter = 0;
const next = () => ++counter;

/** Код помилки Postgres (наприклад, 23505 унікальність, 23514 CHECK, 23503 зовнішній ключ). */
export async function pgErrorCode(action: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
}

export async function makeLocation(db: TestDb, code = `loc${next()}`) {
  const [row] = await db.insert(locations).values({ code, name: code }).returning();
  return row!;
}

export async function makeProfile(
  db: TestDb,
  overrides: Partial<typeof profiles.$inferInsert> = {},
) {
  const [row] = await db
    .insert(profiles)
    .values({ id: randomUUID(), fullName: "Тест", role: "manager", ...overrides })
    .returning();
  return row!;
}

export async function makeClient(db: TestDb, overrides: Partial<typeof clients.$inferInsert> = {}) {
  const [row] = await db
    .insert(clients)
    .values({ code: `${CYRILLIC_PREFIX}${next()}`, name: "Тестовий клієнт", ...overrides })
    .returning();
  return row!;
}

export async function makeOrder(
  db: TestDb,
  overrides: Partial<typeof orders.$inferInsert> & { clientId: string; locationId: string },
) {
  const [row] = await db
    .insert(orders)
    .values({ orderDate: "2026-11-09", ...overrides })
    .returning();
  return row!;
}
