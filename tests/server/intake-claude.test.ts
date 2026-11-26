import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationLogs } from "@/db/schema";
import {
  callClaude,
  CLAUDE_MODEL,
  ClaudeError,
  estimateCostUsd,
  type ClaudeRequest,
} from "@/server/intake/claude";
import { parseResultSchema, toolInputSchema } from "@/server/intake/schema";
import { createTestDb } from "../db/harness";

const VALID = {
  client: { code: "АА21", name_guess: "ДСВ Логістика", confidence: 0.9 },
  order_date: "2026-11-18",
  kg_sold: 40,
  ice_type: "16mm",
  box: { type_code: null, count: null, ownership: null },
  delivery: {
    method: null,
    city: null,
    np_warehouse_number: null,
    address: null,
    time_window: null,
    recipient_name: null,
    recipient_phone: null,
  },
  payment_hint: null,
  comment: null,
  unclear: [],
};

const toolReply = (input: unknown, usage = { input_tokens: 1200, output_tokens: 80 }) =>
  Promise.resolve(
    new Response(
      JSON.stringify({ content: [{ type: "tool_use", name: "record_order", input }], usage }),
    ),
  );

const REQUEST: ClaudeRequest = {
  system: [{ text: "правила" }, { text: "клієнти: АА21|ДСВ", cache: true }],
  user: "ДСВ завтра 40 кг",
};

describe("розбір заявки: схема й клієнт Claude (B11, PR 2)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  const opts = (fetchImpl: unknown) => ({
    apiKey: "sk-ant-TESTKEY",
    fetchImpl: fetchImpl as never,
    retryDelayMs: 0,
  });

  it("схема приймає повну відповідь і відхиляє чужі значення й вихід за межі", () => {
    expect(parseResultSchema.safeParse(VALID).success).toBe(true);
    for (const ice_type of ["2mm", "block"]) {
      expect(parseResultSchema.safeParse({ ...VALID, ice_type }).success).toBe(true);
    }
    const bad = [
      { ...VALID, ice_type: "5mm" },
      { ...VALID, client: { ...VALID.client, confidence: 1.5 } },
      { ...VALID, kg_sold: -3 },
      { ...VALID, order_date: "завтра" },
      { ...VALID, delivery: { ...VALID.delivery, method: "drone" } },
      { ...VALID, unclear: "не ясно" },
    ];
    for (const item of bad) expect(parseResultSchema.safeParse(item).success).toBe(false);
    const schema = toolInputSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(JSON.stringify(schema)).toContain("confidence");
  });

  it("запит: примусовий інструмент, температура 0, 800 токенів, кеш лише на блоці клієнтів, ключ у заголовку", async () => {
    const fetchImpl = vi.fn(() => toolReply(VALID));
    const result = await callClaude(ctx.db, REQUEST, opts(fetchImpl));
    expect(result.result).toMatchObject({ kg_sold: 40 });
    expect(result.model).toBe(CLAUDE_MODEL);
    expect(result.usage).toMatchObject({ inputTokens: 1200, outputTokens: 80 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-TESTKEY");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      tool_choice: { type: "tool", name: "record_order" },
      messages: [{ role: "user", content: "ДСВ завтра 40 кг" }],
    });
    // Нова модель відхиляє `temperature` (400): параметра в запиті немає.
    expect(body).not.toHaveProperty("temperature");
    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools[0].name).toBe("record_order");
    expect(JSON.stringify(body)).not.toContain("TESTKEY");
  });

  it("помилки: без ключа, 4xx з текстом, відповідь без інструмента; без повтору на 4xx", async () => {
    const nokey = vi.fn();
    await expect(
      callClaude(ctx.db, REQUEST, { apiKey: null, fetchImpl: nokey as never }),
    ).rejects.toThrow("Ключ Claude не налаштовано");
    expect(nokey).not.toHaveBeenCalled();
    const unauthorized = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }),
      ),
    );
    await expect(callClaude(ctx.db, REQUEST, opts(unauthorized))).rejects.toThrow(
      "invalid x-api-key",
    );
    expect(unauthorized).toHaveBeenCalledTimes(1);
    const noTool = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ content: [{ type: "text", text: "привіт" }] })),
      ),
    );
    await expect(callClaude(ctx.db, REQUEST, opts(noTool))).rejects.toThrow(
      "не повернув розпізнаних полів",
    );
  });

  it("один повтор на мережу, 429 і 5xx, потім помилка з позначкою мережі", async () => {
    let calls = 0;
    const flaky = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(new Response("{}", { status: 529 })) : toolReply(VALID);
    });
    expect((await callClaude(ctx.db, REQUEST, opts(flaky))).result).toMatchObject({ kg_sold: 40 });
    expect(flaky).toHaveBeenCalledTimes(2);
    const down = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const error = await callClaude(ctx.db, REQUEST, opts(down)).catch((e) => e);
    expect(error).toBeInstanceOf(ClaudeError);
    expect(error.isNetwork).toBe(true);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("журнал викликів: модель, токени, код; без ключа, тексту заявки й клієнтів", async () => {
    await callClaude(ctx.db, REQUEST, opts(vi.fn(() => toolReply(VALID))));
    const dump = JSON.stringify(await ctx.db.select().from(integrationLogs));
    expect(dump).toContain('"service":"claude"');
    expect(dump).toContain("inputTokens");
    for (const leak of ["TESTKEY", "ДСВ завтра", "ДСВ Логістика", "АА21"]) {
      expect(dump, leak).not.toContain(leak);
    }
  });

  it("вартість: читання з кешу дешевше, запис дорожчий, округлення до 5 знаків", () => {
    const plain = estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const cached = estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    const written = estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    expect(cached).toBeCloseTo(plain / 10, 5);
    expect(written).toBeCloseTo(plain * 1.25, 5);
    expect(
      estimateCostUsd({
        inputTokens: 1234,
        outputTokens: 56,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0.00151);
  });
});
