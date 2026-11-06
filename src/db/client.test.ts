import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSql, getSql } from "@/db/client";

const urlA = "postgresql://user:password-a@a.example.com:5432/postgres";
const urlB = "postgresql://user:password-b@b.example.com:5432/postgres";

// Клієнт postgres.js створюється ліниво: справжнього підключення в цих тестах немає.
describe("getSql", () => {
  afterEach(async () => {
    await closeSql();
    vi.unstubAllEnvs();
  });

  it("повертає той самий клієнт, поки DATABASE_URL не змінився", () => {
    vi.stubEnv("DATABASE_URL", urlA);
    expect(getSql()).toBe(getSql());
  });

  it("створює новий клієнт, коли DATABASE_URL змінився", () => {
    vi.stubEnv("DATABASE_URL", urlA);
    const first = getSql();

    vi.stubEnv("DATABASE_URL", urlB);
    const second = getSql();

    expect(second).not.toBe(first);
    expect(getSql()).toBe(second);
  });

  it("після closeSql створює новий клієнт", async () => {
    vi.stubEnv("DATABASE_URL", urlA);
    const first = getSql();

    await closeSql();

    expect(getSql()).not.toBe(first);
  });
});
