import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginFailures } from "@/db/schema";
import {
  checkLoginAllowed,
  LOGIN_LIMITS,
  minutesToWait,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/server/login-limiter";
import { createTestDb, type TestDb } from "../db/harness";

const MINUTE = 60 * 1000;
const NOW = new Date("2026-11-09T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

describe("обмеження спроб входу", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(async () => {
    await db.delete(loginFailures);
  });

  const failures = (email: string, ip: string | null, agesInMinutes: number[]) =>
    db
      .insert(loginFailures)
      .values(agesInMinutes.map((age) => ({ email, ip, createdAt: minutesAgo(age) })));

  describe("за e-mail", () => {
    it("без невдалих спроб вхід дозволено", async () => {
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW)).toEqual({
        allowed: true,
      });
    });

    it("4 невдалі спроби ще дозволяють вхід, 5-та блокує", async () => {
      await failures("a@example.com", null, [1, 2, 3, 4]);
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW)).toEqual({
        allowed: true,
      });

      await recordLoginFailure(db, { email: "a@example.com", ip: null }, NOW);
      const check = await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW);
      expect(check.allowed).toBe(false);
    });

    it("заборона діє, доки найстаріша з останніх п'яти спроб не вийде з 15-хвилинного вікна", async () => {
      // Спроби 14, 10, 8, 5 і 1 хвилину тому: найстаріша вийде з вікна за 1 хвилину.
      await failures("a@example.com", null, [14, 10, 8, 5, 1]);
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW)).toEqual({
        allowed: false,
        retryAfterSeconds: 60,
      });

      // Через 61 секунду найстарішу спробу вже не рахуємо: лишається 4, вхід знову дозволено.
      const later = new Date(NOW.getTime() + 61 * 1000);
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip: null }, later)).toEqual({
        allowed: true,
      });
    });

    it("щойно заблокований e-mail чекає майже все вікно", async () => {
      await failures("a@example.com", null, [0, 0, 0, 0, 0]);
      const check = await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW);
      expect(check).toEqual({ allowed: false, retryAfterSeconds: LOGIN_LIMITS.windowMs / 1000 });
      expect(minutesToWait(900)).toBe(15);
    });

    it("спроби старші за вікно не рахуються", async () => {
      await failures("a@example.com", null, [16, 20, 30, 60, 120]);
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW)).toEqual({
        allowed: true,
      });
    });

    it("інші e-mail не страждають від блокування одного", async () => {
      await failures("a@example.com", null, [1, 2, 3, 4, 5]);
      expect((await checkLoginAllowed(db, { email: "a@example.com", ip: null }, NOW)).allowed).toBe(
        false,
      );
      expect((await checkLoginAllowed(db, { email: "b@example.com", ip: null }, NOW)).allowed).toBe(
        true,
      );
    });

    it("успішний вхід скидає лічильник цього e-mail", async () => {
      await failures("a@example.com", null, [1, 2, 3, 4]);
      await failures("b@example.com", null, [1, 2]);
      await recordLoginSuccess(db, { email: "a@example.com", ip: null }, NOW);

      const left = await db.select().from(loginFailures);
      expect(left.map((row) => row.email)).toEqual(["b@example.com", "b@example.com"]);
    });
  });

  describe("за адресою клієнта", () => {
    const ip = "203.0.113.7";

    it("20 невдалих спроб з різних e-mail блокують усі e-mail з цієї адреси", async () => {
      await db.insert(loginFailures).values(
        Array.from({ length: LOGIN_LIMITS.maxFailuresPerIp }, (_, i) => ({
          email: `user${i}@example.com`,
          ip,
          createdAt: minutesAgo(1 + (i % 10)),
        })),
      );
      const blocked = await checkLoginAllowed(db, { email: "new@example.com", ip }, NOW);
      expect(blocked.allowed).toBe(false);

      // З іншої адреси той самий e-mail можна.
      expect(
        (await checkLoginAllowed(db, { email: "new@example.com", ip: "198.51.100.1" }, NOW))
          .allowed,
      ).toBe(true);
      // Без визначеної адреси перевірка за адресою пропускається.
      expect(
        (await checkLoginAllowed(db, { email: "new@example.com", ip: null }, NOW)).allowed,
      ).toBe(true);
    });

    it("19 спроб ще не блокують", async () => {
      await db.insert(loginFailures).values(
        Array.from({ length: LOGIN_LIMITS.maxFailuresPerIp - 1 }, (_, i) => ({
          email: `user${i}@example.com`,
          ip,
          createdAt: minutesAgo(1),
        })),
      );
      expect((await checkLoginAllowed(db, { email: "new@example.com", ip }, NOW)).allowed).toBe(
        true,
      );
    });

    it("успішний вхід не обнуляє спроби з адреси клієнта", async () => {
      await db.insert(loginFailures).values(
        Array.from({ length: LOGIN_LIMITS.maxFailuresPerIp }, (_, i) => ({
          email: `user${i}@example.com`,
          ip,
          createdAt: minutesAgo(1),
        })),
      );
      await recordLoginSuccess(db, { email: "own@example.com", ip }, NOW);
      expect((await checkLoginAllowed(db, { email: "own@example.com", ip }, NOW)).allowed).toBe(
        false,
      );
    });

    it("якщо діють обидва обмеження, чекати треба довше з двох", async () => {
      await failures("a@example.com", null, [14, 10, 8, 5, 1]); // за e-mail: 1 хвилина
      await db.insert(loginFailures).values(
        Array.from({ length: LOGIN_LIMITS.maxFailuresPerIp }, (_, i) => ({
          email: `other${i}@example.com`,
          ip,
          createdAt: minutesAgo(i === LOGIN_LIMITS.maxFailuresPerIp - 1 ? 5 : 1),
        })),
      );
      // За адресою найстаріша з 20 останніх спроб 5 хвилин тому: ще 10 хвилин.
      expect(await checkLoginAllowed(db, { email: "a@example.com", ip }, NOW)).toEqual({
        allowed: false,
        retryAfterSeconds: 10 * 60,
      });
    });
  });

  describe("очищення", () => {
    it("запис нової спроби видаляє записи старші за добу", async () => {
      await failures("old@example.com", null, [25 * 60, 30 * 60]);
      await failures("fresh@example.com", null, [60]);
      await recordLoginFailure(db, { email: "new@example.com", ip: null }, NOW);

      const emails = (await db.select().from(loginFailures)).map((row) => row.email).sort();
      expect(emails).toEqual(["fresh@example.com", "new@example.com"]);
    });

    it("зберігає адресу клієнта й e-mail без пароля", async () => {
      await recordLoginFailure(db, { email: "a@example.com", ip: "203.0.113.7" }, NOW);
      const [row] = await db
        .select()
        .from(loginFailures)
        .where(eq(loginFailures.email, "a@example.com"));
      expect(row).toMatchObject({ email: "a@example.com", ip: "203.0.113.7" });
      expect(Object.keys(row!).sort()).toEqual(["createdAt", "email", "id", "ip"]);
    });
  });
});
