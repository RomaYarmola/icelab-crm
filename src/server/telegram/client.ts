import { integrationLogs } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Клієнт Telegram Bot API (B11, ТЗ §8 і 8.2). Токен бота лише зі змінної середовища сервера: у базі,
 * журналі викликів, повідомленнях про помилки й адресах для користувача його немає. Таймаут 15 секунд,
 * повтор лише на мережевих помилках і 5xx (затримки 1, 4, 16 с), без повтору на 4xx. У журнал
 * викликів потрапляють метод, кількість спроб і код відповіді, а текст повідомлень і імена ні.
 */

const API_URL = "https://api.telegram.org";
const TIMEOUT_MS = 15_000;
const DEFAULT_DELAYS = [1_000, 4_000, 16_000];

export function getTelegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

/** Помилка Telegram: текст призначений користувачеві й не містить токена. */
export class TelegramError extends Error {
  readonly isNetwork: boolean;
  /** Код відповіді Telegram (`error_code`), якщо вона була. */
  readonly code: number | null;

  constructor(message: string, options: { isNetwork?: boolean; code?: number | null } = {}) {
    super(message);
    this.name = "TelegramError";
    this.isNetwork = options.isNetwork ?? false;
    this.code = options.code ?? null;
  }
}

type Options = {
  token?: string | null;
  fetchImpl?: typeof fetch;
  /** Затримки між повторами, мс (тести: порожній список без повторів). */
  retryDelays?: number[];
};

type TelegramEnvelope<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function writeLog(
  db: AnyPgDatabase | null,
  entry: {
    method: string;
    status: number | null;
    attempts: number;
    durationMs: number;
    errorText: string | null;
  },
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(integrationLogs).values({
      service: "telegram",
      operation: entry.method,
      request: { attempts: entry.attempts },
      response: null,
      status: entry.status,
      durationMs: entry.durationMs,
      errorText: entry.errorText,
    });
  } catch {
    // Збій журналу не повинен ламати виклик.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Викликає метод Bot API. Кидає `TelegramError`. */
export async function callTelegram<T = unknown>(
  db: AnyPgDatabase | null,
  method: string,
  params: Record<string, unknown> = {},
  options: Options = {},
): Promise<T> {
  const token = options.token === undefined ? getTelegramToken() : options.token;
  if (!token) {
    throw new TelegramError(
      "Токен Telegram-бота не налаштовано. Додайте його в змінні середовища сервера.",
    );
  }
  const doFetch = options.fetchImpl ?? fetch;
  const delays = options.retryDelays ?? DEFAULT_DELAYS;
  const started = Date.now();
  const maxAttempts = delays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | null = null;
    let networkFailure = false;
    try {
      response = await doFetch(`${API_URL}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      networkFailure = true;
    }

    const retryable = networkFailure || (response !== null && response.status >= 500);
    if (retryable && attempt < maxAttempts) {
      await sleep(delays[attempt - 1]!);
      continue;
    }
    if (!response) {
      const message = "Немає зв'язку з Telegram. Спробуйте ще раз.";
      await writeLog(db, {
        method,
        status: null,
        attempts: attempt,
        durationMs: Date.now() - started,
        errorText: "мережа",
      });
      throw new TelegramError(message, { isNetwork: true });
    }

    let body: TelegramEnvelope<T> | null = null;
    try {
      body = (await response.json()) as TelegramEnvelope<T>;
    } catch {
      body = null;
    }
    const ok = response.ok && body?.ok === true;
    const description = body?.description?.trim();
    const errorText = ok
      ? null
      : description || `Telegram відповів помилкою (код ${response.status}).`;
    await writeLog(db, {
      method,
      status: response.status,
      attempts: attempt,
      durationMs: Date.now() - started,
      errorText,
    });
    if (!ok) {
      throw new TelegramError(errorText!, {
        isNetwork: false,
        code: body?.error_code ?? response.status,
      });
    }
    return body!.result as T;
  }
  throw new TelegramError("Немає зв'язку з Telegram. Спробуйте ще раз.", { isNetwork: true });
}

// ---------------------------------------------------------------------------------------------
// Потрібні методи
// ---------------------------------------------------------------------------------------------

export type TelegramBotInfo = { id: number; username?: string; first_name?: string };

export type TelegramWebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
};

export const getMe = (db: AnyPgDatabase | null, options?: Options) =>
  callTelegram<TelegramBotInfo>(db, "getMe", {}, options);

export const getWebhookInfo = (db: AnyPgDatabase | null, options?: Options) =>
  callTelegram<TelegramWebhookInfo>(db, "getWebhookInfo", {}, options);

/** Вказує Telegram адресу webhook і секрет, яким він підписуватиме запити. */
export const setWebhook = (
  db: AnyPgDatabase | null,
  params: { url: string; secretToken: string },
  options?: Options,
) =>
  callTelegram<boolean>(
    db,
    "setWebhook",
    {
      url: params.url,
      secret_token: params.secretToken,
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: true,
    },
    options,
  );

export type SendMessageParams = {
  chatId: number;
  text: string;
  /** Відповісти в тред цього повідомлення (топік групи). */
  replyToMessageId?: number;
  threadId?: number;
  /** Кнопки під повідомленням: ряди `{ text, callback_data }`. */
  buttons?: { text: string; callbackData: string }[][];
  /** Відкрити користувачеві поле відповіді під повідомленням (ForceReply, B12); текст підказки в полі. */
  forceReply?: string;
};

export const sendMessage = (
  db: AnyPgDatabase | null,
  params: SendMessageParams,
  options?: Options,
) =>
  callTelegram<{ message_id: number }>(
    db,
    "sendMessage",
    {
      chat_id: params.chatId,
      text: params.text,
      ...(params.threadId ? { message_thread_id: params.threadId } : {}),
      ...(params.replyToMessageId
        ? {
            reply_parameters: {
              message_id: params.replyToMessageId,
              allow_sending_without_reply: true,
            },
          }
        : {}),
      ...(params.buttons
        ? {
            reply_markup: {
              inline_keyboard: params.buttons.map((row) =>
                row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
              ),
            },
          }
        : params.forceReply
          ? { reply_markup: { force_reply: true, input_field_placeholder: params.forceReply } }
          : {}),
    },
    options,
  );

export const editMessageText = (
  db: AnyPgDatabase | null,
  params: { chatId: number; messageId: number; text: string },
  options?: Options,
) =>
  callTelegram(
    db,
    "editMessageText",
    { chat_id: params.chatId, message_id: params.messageId, text: params.text },
    options,
  );

export const answerCallbackQuery = (
  db: AnyPgDatabase | null,
  params: { callbackQueryId: string; text?: string },
  options?: Options,
) =>
  callTelegram(
    db,
    "answerCallbackQuery",
    { callback_query_id: params.callbackQueryId, ...(params.text ? { text: params.text } : {}) },
    options,
  );
