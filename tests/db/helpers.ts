import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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

/** Акаунт у (тестовій) таблиці `auth.users`: профіль не може існувати без нього. */
export async function makeAuthUser(db: TestDb, id: string = randomUUID(), email?: string) {
  await db.execute(
    sql`insert into auth.users (id, email) values (${id}, ${email ?? `${id}@test.local`}) on conflict (id) do nothing`,
  );
  return id;
}

export async function makeProfile(
  db: TestDb,
  overrides: Partial<typeof profiles.$inferInsert> = {},
) {
  const id = await makeAuthUser(db, overrides.id);
  const [row] = await db
    .insert(profiles)
    .values({ fullName: "Тест", role: "manager", ...overrides, id })
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
