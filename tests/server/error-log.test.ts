import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { errorLog } from "@/db/schema";
import {
  cleanPath,
  DEDUPE_WINDOW_MINUTES,
  describeError,
  MAX_MESSAGE_LENGTH,
  MAX_ROWS,
  MAX_STACK_LENGTH,
  reportError,
  RETENTION_DAYS,
  writeErrorLog,
} from "@/server/error-log";
import { createTestDb, type TestDb } from "../db/harness";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

describe("describeError і cleanPath", () => {
  it("бере текст, початок стеку й digest; довге обрізає", () => {
    const error = Object.assign(new Error("x".repeat(5000)), { digest: "1234567" });
    const info = describeError(error);
    expect(info.message).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(info.stack?.length).toBeLessThanOrEqual(MAX_STACK_LENGTH);
    expect(info.digest).toBe("1234567");
  });

  it("не-помилку перетворює на текст", () => {
    expect(describeError("просто текст")).toEqual({
      message: "просто текст",
      stack: undefined,
      digest: undefined,
    });
  });

  it("з адреси прибирає параметри й фрагмент", () => {
    expect(cleanPath("/orders?email=a@b.c&token=1#top")).toBe("/orders");
    expect(cleanPath("/more/users/[id]")).toBe("/more/users/[id]");
    expect(cleanPath(undefined)).toBeNull();
    expect(cleanPath("")).toBeNull();
  });
});

describe("журнал помилок", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  const rows = () => db.select().from(errorLog).orderBy(errorLog.firstSeenAt);

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(async () => {
    await db.delete(errorLog);
    vi.restoreAllMocks();
  });

  it("записує помилку з джерелом, адресою без параметрів і методом", async () => {
    await writeErrorLog(db, {
      source: "render",
      error: new Error("Щось зламалось"),
      path: "/orders?x=1",
      method: "GET",
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      source: "render",
      message: "Щось зламалось",
      path: "/orders",
      method: "GET",
      count: 1,
    });
    expect(row?.stack).toContain("Щось зламалось");
  });

  it("однакову помилку за годину лише рахує, а іншу пише окремим рядком", async () => {
    const entry = { source: "action" as const, error: new Error("Однакова"), path: "/more" };
    await writeErrorLog(db, entry);
    await writeErrorLog(db, entry);
    await writeErrorLog(db, entry);
    await writeErrorLog(db, { ...entry, error: new Error("Інша") });
    await writeErrorLog(db, { ...entry, source: "render" });

    const all = await rows();
    expect(all).toHaveLength(3);
    expect(all.find((row) => row.message === "Однакова" && row.source === "action")?.count).toBe(3);
  });

  it("помилки без адреси теж групуються", async () => {
    await writeErrorLog(db, { source: "proxy", error: new Error("Без адреси") });
    await writeErrorLog(db, { source: "proxy", error: new Error("Без адреси") });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]?.count).toBe(2);
  });

  it(`через ${DEDUPE_WINDOW_MINUTES} хв така сама помилка пишеться знову окремим рядком`, async () => {
    const entry = { source: "route" as const, error: new Error("Давня"), path: "/api/health" };
    await writeErrorLog(db, entry);
    await db.execute(sql`update error_log set last_seen_at = now() - interval '2 hours'`);
    await writeErrorLog(db, entry);
    expect(await rows()).toHaveLength(2);
  });

  it(`рядки старші за ${RETENTION_DAYS} днів видаляються при записі`, async () => {
    await writeErrorLog(db, { source: "render", error: new Error("Стара"), path: "/a" });
    await db.execute(sql`update error_log set last_seen_at = now() - interval '31 days'`);
    await writeErrorLog(db, { source: "render", error: new Error("Нова"), path: "/b" });
    const all = await rows();
    expect(all.map((row) => row.message)).toEqual(["Нова"]);
  });

  it(`у журналі лишається не більше ${MAX_ROWS} найновіших рядків`, async () => {
    await db.execute(sql`
      insert into error_log (source, message, path, last_seen_at)
      select 'render', 'e' || i, '/p' || i, now() - make_interval(secs => i)
      from generate_series(1, ${MAX_ROWS + 50}) as i
    `);
    await writeErrorLog(db, { source: "render", error: new Error("Свіжа"), path: "/fresh" });
    const all = await rows();
    expect(all).toHaveLength(MAX_ROWS);
    expect(all.some((row) => row.message === "Свіжа")).toBe(true);
    // Найстаріші видалено.
    expect(all.some((row) => row.message === `e${MAX_ROWS + 50}`)).toBe(false);
  });

  it("reportError пише в консоль і в базу", async () => {
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportError({ source: "form_action", error: new Error("З дії форми") });
    expect(log).toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ source: "form_action", message: "З дії форми" });
  });

  it("reportError не кидає помилок, навіть якщо база недоступна", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("немає DATABASE_URL");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      reportError({ source: "render", error: new Error("Збій") }),
    ).resolves.toBeUndefined();
    // Помилку записано хоча б у консоль, а збій журналу відображено окремим рядком.
    expect(log).toHaveBeenCalledTimes(2);
  });
});
