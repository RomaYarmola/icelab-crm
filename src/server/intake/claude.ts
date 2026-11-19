import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { toolInputSchema } from "./schema";

/**
 * Клієнт Claude API для розбору заявок (B11, ТЗ 8.3, D139, D140). Напряму через `fetch`, без
 * додаткових бібліотек. Без параметра temperature (нова модель його відхиляє, 400), до 800 токенів, таймаут 20 секунд, один повтор на мережу, 429
 * і 5xx. Результат модель віддає через примусовий інструмент зі схемою. Ключ лише зі змінної
 * середовища сервера. У журнал викликів потрапляють модель, токени й код відповіді, а текст заявки,
 * список клієнтів і відповідь ні (це персональні дані).
 */

export const CLAUDE_MODEL = "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_000;
const TOOL_NAME = "record_order";

export function getAnthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Помилка розбору: текст призначений користувачеві й не містить ключа. */
export class ClaudeError extends Error {
  readonly isNetwork: boolean;
  constructor(message: string, options: { isNetwork?: boolean } = {}) {
    super(message);
    this.name = "ClaudeError";
    this.isNetwork = options.isNetwork ?? false;
  }
}

export type ClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Орієнтовна вартість, USD за мільйон токенів. **Це оцінка**, а не прайс Anthropic: точні ціни
 * моделі перевіряємо перед запуском (docs/blocks/B11-intake.md). Читання з кешу дешевше в 10 разів,
 * запис у кеш дорожчий на чверть.
 */
export const PRICE_PER_MTOK = { input: 1, output: 5 };

export function estimateCostUsd(usage: ClaudeUsage): number {
  const inputPrice = PRICE_PER_MTOK.input;
  const cost =
    (usage.inputTokens * inputPrice +
      usage.cacheReadTokens * inputPrice * 0.1 +
      usage.cacheWriteTokens * inputPrice * 1.25 +
      usage.outputTokens * PRICE_PER_MTOK.output) /
    1_000_000;
  return Math.round(cost * 100_000) / 100_000;
}

export type ClaudeRequest = {
  /** Правила й довідники: перший блок кешується (він великий і не змінюється між заявками). */
  system: { text: string; cache?: boolean }[];
  user: string;
};

export type ClaudeResponse = { result: unknown; usage: ClaudeUsage; model: string };

type Options = {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  model?: string;
};

type MessagesBody = {
  content?: { type: string; name?: string; input?: unknown }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { message?: string };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeLog(
  db: AnyPgDatabase | null,
  entry: {
    status: number | null;
    durationMs: number;
    usage: ClaudeUsage | null;
    errorText: string | null;
    attempts: number;
  },
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(integrationLogs).values({
      service: "claude",
      operation: "messages",
      request: { model: CLAUDE_MODEL, attempts: entry.attempts },
      response: entry.usage ? { usage: entry.usage } : null,
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Журнал не повинен ламати виклик.
  }
}

/** Просить Claude розібрати заявку й повернути поля через інструмент. Кидає `ClaudeError`. */
export async function callClaude(
  db: AnyPgDatabase | null,
  request: ClaudeRequest,
  options: Options = {},
): Promise<ClaudeResponse> {
  const apiKey = options.apiKey === undefined ? getAnthropicKey() : options.apiKey;
  if (!apiKey) {
    throw new ClaudeError("Ключ Claude не налаштовано. Додайте його в змінні середовища сервера.");
  }
  const model = options.model ?? CLAUDE_MODEL;
  const body = JSON.stringify({
    model,
    max_tokens: 800,
    system: request.system.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" } } : {}),
    })),
    messages: [{ role: "user", content: request.user }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Записати розпізнані поля заявки на замовлення.",
        input_schema: toolInputSchema(),
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const started = Date.now();
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await (options.fetchImpl ?? fetch)(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      response = null;
    }
    const retryable = response === null || response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      await sleep(options.retryDelayMs ?? RETRY_DELAY_MS);
      continue;
    }
    if (!response) {
      await writeLog(db, {
        status: null,
        durationMs: Date.now() - started,
        usage: null,
        errorText: "мережа",
        attempts: attempt,
      });
      throw new ClaudeError("Немає зв'язку з Claude. Спробуйте ще раз.", { isNetwork: true });
    }

    let data: MessagesBody | null = null;
    try {
      data = (await response.json()) as MessagesBody;
    } catch {
      data = null;
    }
    const usage: ClaudeUsage | null = data?.usage
      ? {
          inputTokens: data.usage.input_tokens ?? 0,
          outputTokens: data.usage.output_tokens ?? 0,
          cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
        }
      : null;
    const tool = data?.content?.find(
      (block) => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!response.ok || !tool) {
      const reason = data?.error?.message?.trim();
      const message = response.ok
        ? "Claude не повернув розпізнаних полів."
        : reason || `Claude відповів помилкою (код ${response.status}).`;
      await writeLog(db, {
        status: response.status,
        durationMs: Date.now() - started,
        usage,
        errorText: message,
        attempts: attempt,
      });
      throw new ClaudeError(message);
    }
    await writeLog(db, {
      status: response.status,
      durationMs: Date.now() - started,
      usage,
      errorText: null,
      attempts: attempt,
    });
    return {
      result: tool.input,
      usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model,
    };
  }
  throw new ClaudeError("Немає зв'язку з Claude. Спробуйте ще раз.", { isNetwork: true });
}
