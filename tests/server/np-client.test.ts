import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationLogs } from "@/db/schema";
import { callNp, NpError, redactSecrets } from "@/server/np/client";
import { createTestDb } from "../db/harness";

/** Відповідь Нової Пошти для підміненого `fetch`. */
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const CALL = {
  modelName: "Counterparty",
  calledMethod: "getCounterparties",
  methodProperties: { CounterpartyProperty: "Sender" },
};

describe("клієнт Нової Пошти (B10, D122, D123)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  it("без ключа кидає зрозумілу помилку й не робить запиту", async () => {
    const fetchImpl = vi.fn();
    await expect(
      callNp(ctx.db, CALL, { apiKey: null, fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("Ключ Нової Пошти не налаштовано");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("надсилає ключ у тілі запиту, повертає дані й попередження", async () => {
    const fetchImpl = vi.fn(() =>
      reply({ success: true, data: [{ Ref: "a" }], warnings: ["Увага"], errors: [] }),
    );
    const result = await callNp<{ Ref: string }>(ctx.db, CALL, {
      apiKey: "ключ-для-тесту",
      fetchImpl: fetchImpl as never,
    });
    expect(result.data).toEqual([{ Ref: "a" }]);
    expect(result.warnings).toEqual(["Увага"]);
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(sent).toMatchObject({ apiKey: "ключ-для-тесту", modelName: "Counterparty" });
  });

  it("success: false: текст помилки Нової Пошти як є, повтору немає", async () => {
    const fetchImpl = vi.fn(() =>
      reply({ success: false, data: [], errors: ["API key is invalid"], warnings: [] }),
    );
    await expect(
      callNp(ctx.db, CALL, { apiKey: "k", fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("API key is invalid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("мережева помилка: три спроби, потім помилка з позначкою мережі", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const error = await callNp(ctx.db, CALL, {
      apiKey: "k",
      fetchImpl: fetchImpl as never,
      retryDelayMs: 0,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(NpError);
    expect((error as NpError).isNetwork).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("мережева помилка, яка минула: друга спроба успішна", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(() =>
      ++calls === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : reply({ success: true, data: [] }),
    );
    const result = await callNp(ctx.db, CALL, {
      apiKey: "k",
      fetchImpl: fetchImpl as never,
      retryDelayMs: 0,
    });
    expect(result.data).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("не JSON або код 500: помилка з кодом, без падіння", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("<html>", { status: 502 })));
    await expect(
      callNp(ctx.db, CALL, { apiKey: "k", fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("код 502");
  });

  it("журнал викликів: операція, кількість записів, помилки; ключа і даних немає", async () => {
    const SECRET = "дуже-секретний-ключ-123";
    const fetchImpl = vi.fn(() =>
      reply({ success: true, data: [{ Ref: "x", Phones: "+380501112233" }], errors: [] }),
    );
    await callNp(
      ctx.db,
      { ...CALL, methodProperties: { ApiKey: SECRET, Page: "1" } },
      { apiKey: SECRET, fetchImpl: fetchImpl as never },
    );
    const rows = await ctx.db.select().from(integrationLogs);
    const last = rows.at(-1)!;
    expect(last.service).toBe("np");
    expect(last.operation).toBe("Counterparty/getCounterparties");
    expect(last.status).toBe(200);
    expect(last.response).toMatchObject({ success: true, count: 1 });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("+380501112233");
  });

  it("redactSecrets прибирає ключ на будь-якій глибині", () => {
    const cleaned = JSON.stringify(
      redactSecrets({ a: { apiKey: "1", b: [{ API_KEY: "2" }] }, c: 3 }),
    );
    expect(cleaned).not.toMatch(/"[12]"/);
    expect(cleaned).toContain('"c":3');
  });
});
