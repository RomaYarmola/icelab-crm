import { and, eq, gt, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { intakeMessages, locations, profiles, telegramLinkCodes } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { handleCallback, type FlowDeps, type TgCallback } from "../intake/telegram-flow";
import { sendMessage } from "./client";
import { canDeliverOrders } from "../permissions";
import { driverByTelegram, handleDriverCallback, handleDriverMessage } from "./driver-flow";
import {
  getTelegramSettings,
  isCaptureActive,
  setTelegramSettings,
  type TelegramSettings,
} from "./settings";

/**
 * Обробка подій Telegram (B11, ТЗ 8.2): повідомлення групи по топіках Київ і Львів, прив'язка
 * користувачів командою `/start КОД`, «визначення топіка» власником. У цьому кроці повідомлення лише
 * записуємо в `intake_messages` (розбір додається далі). Повторна подія з тим самим номером
 * повідомлення нічого не дублює. Помилки відправки відповіді не ламають приймання.
 */

type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TgChat = { id: number; type: string };
export type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  voice?: { file_id: string };
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallback;
};

export type UpdateOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "bound"; profileId: string }
  | { kind: "bind_failed"; reason: string }
  | { kind: "captured"; target: "kyiv" | "lviv" }
  | { kind: "stored"; id: string; status: "new" | "skipped"; location: "kyiv" | "lviv" }
  | { kind: "updated"; id: string }
  | { kind: "callback"; result: string };

type Deps = FlowDeps & {
  /** Надіслати відповідь; у тестах підміна. */
  send?: (params: Parameters<typeof sendMessage>[1]) => Promise<unknown>;
  now?: Date;
};

const TOPIC_LABELS = { kyiv: "Київ", lviv: "Львів" } as const;

async function reply(
  db: AnyPgDatabase,
  deps: Deps,
  chatId: number,
  text: string,
  extra: { threadId?: number; replyTo?: number } = {},
): Promise<void> {
  try {
    const send = deps.send ?? ((params) => sendMessage(db, params));
    await send({ chatId, text, threadId: extra.threadId, replyToMessageId: extra.replyTo });
  } catch {
    // Відповідь не вдалась (мережа, бот видалений з групи): приймання від цього не залежить.
  }
}

/** Запис про користувача за його Telegram: лише активні профілі. */
async function profileByTelegram(db: AnyPgDatabase, telegramUserId: number) {
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.telegramUserId, telegramUserId), eq(profiles.isActive, true)));
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Особисте листування: /start КОД
// ---------------------------------------------------------------------------------------------

const START = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i;

async function handlePrivate(
  db: AnyPgDatabase,
  message: TgMessage,
  deps: Deps,
): Promise<UpdateOutcome> {
  const chatId = message.chat.id;
  const from = message.from;
  const text = message.text?.trim() ?? "";
  const match = START.exec(text);
  if (from && !match && text !== "") {
    const driver = await driverByTelegram(db, from.id);
    if (driver) {
      await handleDriverMessage(db, driver, from, chatId, text, deps);
      return { kind: "ignored", reason: "водій" };
    }
  }
  if (!from || !match) {
    if (text.startsWith("/") || text === "")
      return { kind: "ignored", reason: "не команда /start" };
    await reply(
      db,
      deps,
      chatId,
      "Заявки приймаю в групі. Тут працює лише команда /start з кодом із CRM.",
    );
    return { kind: "ignored", reason: "особисте повідомлення" };
  }
  const code = match[1]?.toUpperCase();
  if (!code && from) {
    // Прив'язаний водій: `/start` без коду показує його доставки (B12).
    const driver = await driverByTelegram(db, from.id);
    if (driver) {
      await handleDriverMessage(db, driver, from, chatId, text, deps);
      return { kind: "ignored", reason: "водій: /start" };
    }
  }
  if (!code) {
    await reply(
      db,
      deps,
      chatId,
      "Щоб підключити Telegram, візьміть код у CRM (екран «Прийом заявок») і надішліть мені: /start КОД.",
    );
    return { kind: "ignored", reason: "/start без коду" };
  }

  const now = deps.now ?? new Date();
  const [row] = await db
    .select({ code: telegramLinkCodes, profile: profiles })
    .from(telegramLinkCodes)
    .innerJoin(profiles, eq(profiles.id, telegramLinkCodes.profileId))
    .where(
      and(
        eq(telegramLinkCodes.code, code),
        isNull(telegramLinkCodes.usedAt),
        gt(telegramLinkCodes.expiresAt, now),
      ),
    );
  if (!row || !row.profile.isActive) {
    await reply(db, deps, chatId, "Код не підходить або застарів. Створіть новий у CRM.");
    return { kind: "bind_failed", reason: "код не підходить" };
  }
  const taken = await profileByTelegram(db, from.id);
  if (taken && taken.id !== row.profile.id) {
    await reply(db, deps, chatId, "Цей Telegram уже підключений до іншого користувача.");
    return { kind: "bind_failed", reason: "Telegram зайнятий" };
  }

  await withActor(db, row.profile.id, async (tx) => {
    await tx
      .update(profiles)
      .set({ telegramUserId: from.id })
      .where(eq(profiles.id, row.profile.id));
    await tx
      .update(telegramLinkCodes)
      .set({ usedAt: now })
      .where(eq(telegramLinkCodes.code, row.code.code));
  });
  // Власник отримує підсумки дня в особистий чат: запам'ятовуємо його.
  if (row.profile.role === "owner") {
    await setTelegramSettings(db, row.profile.id, { ownerChatId: chatId });
  }
  await reply(
    db,
    deps,
    chatId,
    canDeliverOrders(row.profile.role)
      ? `Готово, ${row.profile.fullName}. Telegram підключено. Напишіть /today, щоб побачити доставки на сьогодні.`
      : `Готово, ${row.profile.fullName}. Telegram підключено до CRM.`,
  );
  return { kind: "bound", profileId: row.profile.id };
}

// ---------------------------------------------------------------------------------------------
// Група: визначення топіка й запис заявок
// ---------------------------------------------------------------------------------------------

async function locationIdFor(db: AnyPgDatabase, which: "kyiv" | "lviv"): Promise<string | null> {
  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, which));
  return row?.id ?? null;
}

function topicOf(settings: TelegramSettings, threadId: number | undefined): "kyiv" | "lviv" | null {
  if (threadId === undefined) return null;
  if (settings.topicKyiv === threadId) return "kyiv";
  if (settings.topicLviv === threadId) return "lviv";
  return null;
}

async function handleGroup(
  db: AnyPgDatabase,
  message: TgMessage,
  isEdit: boolean,
  deps: Deps,
): Promise<UpdateOutcome> {
  const from = message.from;
  const settings = await getTelegramSettings(db);
  const now = deps.now ?? new Date();

  // «Визначити топік»: наступне повідомлення прив'язаного власника в потрібному топіку.
  if (!isEdit && isCaptureActive(settings.capture, now) && from) {
    const sender = await profileByTelegram(db, from.id);
    if (sender?.role === "owner") {
      const target = settings.capture!.target;
      if (message.message_thread_id === undefined) {
        await reply(
          db,
          deps,
          message.chat.id,
          "Напишіть у потрібному топіку групи, а не в загальній стрічці.",
          {
            replyTo: message.message_id,
          },
        );
        return { kind: "ignored", reason: "визначення топіка: немає топіка" };
      }
      await setTelegramSettings(db, sender.id, {
        groupChatId: message.chat.id,
        [target === "kyiv" ? "topicKyiv" : "topicLviv"]: message.message_thread_id,
        capture: null,
      });
      await reply(db, deps, message.chat.id, `Топік «${TOPIC_LABELS[target]}» запам'ятовано.`, {
        threadId: message.message_thread_id,
        replyTo: message.message_id,
      });
      return { kind: "captured", target };
    }
  }

  if (settings.groupChatId === null || message.chat.id !== settings.groupChatId) {
    return { kind: "ignored", reason: "чужа група" };
  }
  const topic = topicOf(settings, message.message_thread_id);
  if (!topic) return { kind: "ignored", reason: "поза топіками Київ і Львів" };

  const text = (message.text ?? message.caption ?? "").trim();
  if (!message.voice && text === "") return { kind: "ignored", reason: "немає тексту" };
  if (text.startsWith("/")) return { kind: "ignored", reason: "команда" };

  // Змінене повідомлення: оновлюємо текст, поки заявку ще не розібрано чи вона не вдалась.
  const [existing] = await db
    .select()
    .from(intakeMessages)
    .where(
      and(
        eq(intakeMessages.telegramChatId, message.chat.id),
        eq(intakeMessages.telegramMessageId, message.message_id),
      ),
    );
  if (existing) {
    if (isEdit && text !== "" && ["new", "failed"].includes(existing.parseStatus)) {
      await db
        .update(intakeMessages)
        .set({ text, parseStatus: "new", parseError: null })
        .where(eq(intakeMessages.id, existing.id));
      return { kind: "updated", id: existing.id };
    }
    return { kind: "ignored", reason: "повідомлення вже записане" };
  }

  const sender = from ? await profileByTelegram(db, from.id) : null;
  let skipReason: string | null = null;
  if (!from || from.is_bot) skipReason = "повідомлення від бота";
  else if (!sender) skipReason = "відправник не підключений до CRM";
  else if (sender.role !== "manager" && sender.role !== "owner") {
    skipReason = "заявки приймаємо лише від менеджерів і власника";
  } else if (message.voice && text === "") skipReason = "голосові поки не підтримуємо";

  const [created] = await db
    .insert(intakeMessages)
    .values({
      channel: message.voice && text === "" ? "voice" : "telegram",
      telegramChatId: message.chat.id,
      telegramMessageId: message.message_id,
      telegramThreadId: message.message_thread_id ?? null,
      telegramUserId: from?.id ?? null,
      locationId: await locationIdFor(db, topic),
      text,
      voiceFileId: message.voice?.file_id ?? null,
      parseStatus: skipReason ? "skipped" : "new",
      skipReason,
    })
    .onConflictDoNothing()
    .returning({ id: intakeMessages.id });
  if (!created) return { kind: "ignored", reason: "повідомлення вже записане" };
  return {
    kind: "stored",
    id: created.id,
    status: skipReason ? "skipped" : "new",
    location: topic,
  };
}

/** Головна точка: одна подія Telegram: повідомлення групи, особисте листування чи натискання кнопки. */
export async function handleUpdate(
  db: AnyPgDatabase,
  update: TgUpdate,
  deps: Deps = {},
): Promise<UpdateOutcome> {
  if (update.callback_query?.data?.startsWith("drv:")) {
    const result = await handleDriverCallback(db, update.callback_query, deps);
    return { kind: "callback", result };
  }
  if (update.callback_query) {
    const result = await handleCallback(db, update.callback_query, deps);
    return { kind: "callback", result: result.kind };
  }
  const message = update.message ?? update.edited_message;
  if (!message) return { kind: "ignored", reason: "це не повідомлення" };
  if (message.chat.type === "private") return handlePrivate(db, message, deps);
  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    return handleGroup(db, message, Boolean(update.edited_message), deps);
  }
  return { kind: "ignored", reason: "канал чи інший чат" };
}
