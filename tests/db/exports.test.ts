import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { auditLog, dataExports } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeProfile, pgErrorCode } from "./helpers";

const CHECK_VIOLATION = "23514";
const INTEGRITY_VIOLATION = "23000";
const RESTRICT_VIOLATION = "23001";
const NOT_NULL_VIOLATION = "23502";
const INVALID_ENUM = "22P02";

describe("журнал експортів: таблиця exports (міграція 0011, D95)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let ownerId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = (await makeProfile(db, { role: "owner" })).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const insertExport = (values: Partial<typeof dataExports.$inferInsert> = {}) =>
    withActor(db, ownerId, async (tx) => {
      const [row] = await tx
        .insert(dataExports)
        .values({
          kind: "orders",
          params: { dateFrom: "2026-11-01" },
          rowCount: 12,
          fileName: "zamovlennia-2026-11-13.xlsx",
          createdBy: ownerId,
          ...values,
        })
        .returning();
      return row!;
    });

  it("зберігає, хто, що, з якими фільтрами й скільки рядків вивантажив", async () => {
    const row = await insertExport();
    expect(row).toMatchObject({
      kind: "orders",
      params: { dateFrom: "2026-11-01" },
      rowCount: 12,
      fileName: "zamovlennia-2026-11-13.xlsx",
      fileUrl: null,
      createdBy: ownerId,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("фільтри за замовчуванням порожній об'єкт, кількість рядків не від'ємна", async () => {
    const [row] = await db
      .insert(dataExports)
      .values({ kind: "all", rowCount: 0, fileName: "x.xlsx", createdBy: ownerId })
      .returning();
    expect(row!.params).toEqual({});
    expect(await pgErrorCode(insertExport({ rowCount: -1 }))).toBe(CHECK_VIOLATION);
  });

  it("не приймає невідомий вид експорту, порожню назву файлу й автора", async () => {
    expect(await pgErrorCode(insertExport({ kind: "boxes" as never }))).toBe(INVALID_ENUM);
    expect(await pgErrorCode(insertExport({ fileName: null as never }))).toBe(NOT_NULL_VIOLATION);
    expect(
      await pgErrorCode(insertExport({ createdBy: "00000000-0000-4000-8000-000000000000" })),
    ).toBe("23503");
  });

  it("запис не змінюють і не видаляють: це перевіряє база", async () => {
    const row = await insertExport();
    expect(
      await pgErrorCode(
        db.update(dataExports).set({ rowCount: 1 }).where(eq(dataExports.id, row.id)),
      ),
    ).toBe(INTEGRITY_VIOLATION);
    expect(await pgErrorCode(db.delete(dataExports).where(eq(dataExports.id, row.id)))).toBe(
      INTEGRITY_VIOLATION,
    );
    const [still] = await db.select().from(dataExports).where(eq(dataExports.id, row.id));
    expect(still!.rowCount).toBe(12);
  });

  it("користувача з експортами не можна видалити", async () => {
    const author = await makeProfile(db, { role: "accountant" });
    await insertExport({ createdBy: author.id });
    const { profiles } = await import("@/db/schema");
    expect(await pgErrorCode(db.delete(profiles).where(eq(profiles.id, author.id)))).toBe(
      RESTRICT_VIOLATION,
    );
  });

  it("кожен експорт потрапляє в журнал змін з автором", async () => {
    const row = await insertExport({ kind: "clients", rowCount: 3 });
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "exports"), eq(auditLog.rowId, row.id)));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert", actorId: ownerId });
    expect(entries[0]!.diff).toMatchObject({
      kind: { new: "clients" },
      row_count: { new: 3 },
      created_by: { new: ownerId },
    });
  });
});
