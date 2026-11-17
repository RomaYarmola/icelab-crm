import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationLogs } from "@/db/schema";
import {
  answerCallbackQuery,
  callTelegram,
  sendMessage,
  setWebhook,
  TelegramError,
} from "@/server/telegram/client";
import { createTestDb } from "../db/harness";

const ok = (result: unknown) => Promise.resolve(new Response(JSON.stringify({ ok: true, result })));
const fail = (status: number, description: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: false, error_code: status, description }), { status }),
  );

describe("клієнт Telegram Bot API (B11)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  const opts = (fetchImpl: unknown, retryDelays: number[] = []) => ({
    token: "123:TOKEN-VALUE",
    fetchImpl: fetchImpl as never,
    retryDelays,
  });

  it("без токена: зрозуміла помилка й жодного запиту", async () => {
    const fetchImpl = vi.fn();
    await expect(
      callTelegram(
        ctx.db,
        "getMe",
        {},
        opts(fetchImpl) && { token: null, fetchImpl: fetchImpl as never },
      ),
    ).rejects.toThrow("Токен Telegram-бота не налаштовано");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("успіх: результат повертається, токен лише в адресі запиту", async () => {
    const fetchImpl = vi.fn(() => ok({ message_id: 7 }));
    const result = await sendMessage(
      ctx.db,
      {
        chatId: -100,
        text: "Привіт",
        threadId: 5,
        replyToMessageId: 9,
        buttons: [[{ text: "Так", callbackData: "ord:1:confirm" }]],
      },
      opts(fetchImpl),
    );
    expect(result).toEqual({ message_id: 7 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:TOKEN-VALUE/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      chat_id: -100,
      text: "Привіт",
      message_thread_id: 5,
      reply_parameters: { message_id: 9 },
      reply_markup: { inline_keyboard: [[{ text: "Так", callback_data: "ord:1:confirm" }]] },
    });
    expect(JSON.stringify(body)).not.toContain("TOKEN-VALUE");
  });

  it("4xx: текст Telegram як є, без повторів", async () => {
    const fetchImpl = vi.fn(() => fail(403, "Forbidden: bot was blocked by the user"));
    const error = await sendMessage(
      ctx.db,
      { chatId: 1, text: "x" },
      opts(fetchImpl, [0, 0]),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.message).toContain("bot was blocked");
    expect(error.code).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("мережа й 5xx: повтори, потім успіх або помилка з позначкою мережі", async () => {
    let calls = 0;
    const flaky = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new TypeError("fetch failed"));
      if (calls === 2) return fail(502, "Bad Gateway");
      return ok(true);
    });
    expect(
      await answerCallbackQuery(ctx.db, { callbackQueryId: "q" }, opts(flaky, [0, 0, 0])),
    ).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(3);
    const down = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const error = await sendMessage(ctx.db, { chatId: 1, text: "x" }, opts(down, [0, 0])).catch(
      (e) => e,
    );
    expect(error.isNetwork).toBe(true);
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("журнал викликів: метод, спроби, код; токена, тексту й чату немає", async () => {
    await sendMessage(
      ctx.db,
      { chatId: -1001234567890, text: "Секретний текст замовлення +380501234567" },
      opts(vi.fn(() => ok({ message_id: 1 }))),
    );
    await setWebhook(
      ctx.db,
      { url: "https://x.example/api/telegram/webhook", secretToken: "SECRET-WEBHOOK" },
      opts(vi.fn(() => ok(true))),
    );
    const dump = JSON.stringify(await ctx.db.select().from(integrationLogs));
    expect(dump).toContain("sendMessage");
    expect(dump).toContain("setWebhook");
    for (const leak of [
      "TOKEN-VALUE",
      "SECRET-WEBHOOK",
      "Секретний",
      "380501234567",
      "1001234567890",
    ]) {
      expect(dump, leak).not.toContain(leak);
    }
  });
});
