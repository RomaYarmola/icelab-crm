import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Будь-яка база Drizzle для Postgres: справжня (postgres.js) або тестова (PGlite).
 * Параметри типу свідомо вільні, щоб функції працювали з обома драйверами.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDatabase = PgDatabase<any, any, any>;
