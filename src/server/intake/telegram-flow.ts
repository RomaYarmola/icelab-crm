import { and, eq, isNull } from "drizzle-orm";
import {
  boxTypes,
  clients,
  iceTypes,
  intakeMessages,
  locations,
  orders,
  profiles,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import { formatIsoDate } from "@/utils/isoDate";
import { ValidationError } from "../errors";
import type { AppUser } from "../guards";
import { getPublicUrl } from "../box-labels";
import { deleteDraftOrder } from "../orders";
import { transitionOrder } from "../order-status";
import { notifyOrderChange } from "../production-signal";
import { answerCallbackQuery, editMessageText, sendMessage } from "../telegram/client";
import { processIntakeMessage, type ProcessDeps, type ProcessOutcome } from "./process";
import type { DraftBuild } from "./draft";

/**
 * Чернетка в Telegram (B11, ТЗ 6.13, 8.2, D142–D144): відповідь бота в тред заявки з кнопками й
 * обробка кнопок. Кнопки працюють лише для менеджерів і власника, чия роль визначається за прив'язаним
 * Telegram; повторне натискання по вже обробленому замовленню нічого не створює й не міняє.
 */

/** Як бот пише в Telegram. Підміняється в тестах. */
export type TelegramSender = {
  send: (params: Parameters<typeof sendMessage>[1]) => Promise<unknown>;
  edit: (params: Parameters<typeof editMessageText>[1]) => Promise<unknown>;
  answer: (params: Parameters<typeof answerCallbackQuery>[1]) => Promise<unknown>;
};

export function realSender(db: AnyPgDatabase): TelegramSender {
  return {
    send: (params) => sendMessage(db, params),
    edit: (params) => editMessageText(db, params),
    answer: (params) => answerCallbackQuery(db, params),
  };
}

export type FlowDeps = Partial<TelegramSender> & {
  claude?: ProcessDeps["claude"];
  now?: Date;
};

const withSender = (db: AnyPgDatabase, deps: FlowDeps): TelegramSender => ({
  ...realSender(db),
  ...(deps.send ? { send: deps.send } : {}),
  ...(deps.edit ? { edit: deps.edit } : {}),
  ...(deps.answer ? { answer: deps.answer } : {}),
});

/** Відповідь Telegram, що не вдалась (бота вилучили з групи, мережа), приймання не ламає. */
async function safely(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    // Не вдалося написати в Telegram: заявка й чернетка вже збережені.
  }
}

// ---------------------------------------------------------------------------------------------
// Дані кнопок
// ---------------------------------------------------------------------------------------------

export type CallbackAction = "confirm" | "edit" | "reject";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ord:<id замовлення>:confirm|edit|reject`: до 64 байт, як вимагає Telegram. */
export function callbackData(orderId: string, action: CallbackAction): string {
  return `ord:${orderId}:${action}`;
}

export function parseCallbackData(
  data: string | undefined,
): { orderId: string; action: CallbackAction } | null {
  const match = /^ord:([^:]+):(confirm|edit|reject)$/.exec(data ?? "");
  if (!match || !UUID.test(match[1]!)) return null;
  return { orderId: match[1]!, action: match[2] as CallbackAction };
}

// ---------------------------------------------------------------------------------------------
// Текст чернетки
// ---------------------------------------------------------------------------------------------

/** Короткий опис чернетки для повідомлення в групі: клієнт, кг, лід, доставка, дата й що неясно. */
export async function describeDraft(
  db: AnyPgDatabase,
  orderId: string,
): Promise<{ text: string; isPlaceholder: boolean; number: number | null } | null> {
  const [row] = await db
    .select({
      order: orders,
      clientName: clients.name,
      isPlaceholder: clients.isPlaceholder,
      iceName: iceTypes.name,
      boxName: boxTypes.name,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)));
  if (!row) return null;
  const { order } = row;
  const kg = Number(order.kgSold);
  const delivery = DELIVERY_METHOD_LABELS[order.deliveryMethod];
  const parts = [
    row.clientName,
    kg > 0 ? `${kg.toLocaleString("uk-UA")} кг` : null,
    row.iceName,
    order.deliveryText
      ? `${delivery} (${order.deliveryText})`
      : `доставка: ${delivery.toLowerCase()}`,
    order.timeWindow ? `вікно ${order.timeWindow}` : null,
    formatIsoDate(order.orderDate),
  ].filter(Boolean);
  const lines = [`Чернетка № ${order.number ?? "—"}: ${parts.join(", ")}.`];
  if (row.boxName && order.boxCount > 0) lines.push(`Тара: ${order.boxCount} × ${row.boxName}.`);
  const unclear = (order.draftPayload as { unclear?: string[] } | null)?.unclear ?? [];
  if (unclear.length > 0) lines.push(`Неясно: ${unclear.join("; ")}`);
  return { text: lines.join("\n"), isPlaceholder: row.isPlaceholder, number: order.number };
}

/** Кнопки під чернеткою: без «Підтвердити», поки клієнта не визначено. */
export function draftButtons(orderId: string, isPlaceholder: boolean) {
  const row = [
    ...(isPlaceholder
      ? []
      : [{ text: "Підтвердити", callbackData: callbackData(orderId, "confirm") }]),
    { text: "Виправити", callbackData: callbackData(orderId, "edit") },
    { text: "Відхилити", callbackData: callbackData(orderId, "reject") },
  ];
  return [row];
}

// ---------------------------------------------------------------------------------------------
// Розбір повідомлення й відповідь у тред
// ---------------------------------------------------------------------------------------------

/**
 * Розбирає повідомлення-заявку й відповідає в тред: чернеткою з кнопками, повідомленням про
 * помилку розбору чи про вичерпаний ліміт. Нічого не робить для вже оброблених повідомлень.
 */
export async function processAndReply(
  db: AnyPgDatabase,
  messageId: string,
  deps: FlowDeps = {},
): Promise<ProcessOutcome> {
  const outcome = await processIntakeMessage(db, messageId, deps);
  if (outcome.status === "skipped" || outcome.status === "noop") return outcome;
  const telegram = withSender(db, deps);
  const [message] = await db.select().from(intakeMessages).where(eq(intakeMessages.id, messageId));
  if (!message?.telegramChatId) return outcome;
  const target = {
    chatId: message.telegramChatId,
    threadId: message.telegramThreadId ?? undefined,
    replyToMessageId: message.telegramMessageId ?? undefined,
  };
  const base = await getPublicUrl(db);

  if (outcome.status === "failed") {
    await safely(() =>
      telegram.send({
        ...target,
        text: `Не зміг розібрати, створіть замовлення в CRM: ${base}/orders/new`,
      }),
    );
    return outcome;
  }

  const described = await describeDraft(db, outcome.orderId);
  if (!described) return outcome;
  const updated = outcome.status === "drafted" && outcome.updated;
  const header =
    outcome.status === "limit"
      ? "Ліміт розбору на сьогодні вичерпано, заповніть чернетку в CRM.\n"
      : updated
        ? "Чернетку оновлено за зміненим повідомленням.\n"
        : "";
  await safely(() =>
    telegram.send({
      ...target,
      text: `${header}${described.text}`,
      buttons: draftButtons(outcome.orderId, described.isPlaceholder),
    }),
  );
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Кнопки
// ---------------------------------------------------------------------------------------------

export type TgCallback = {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number }; message_thread_id?: number };
};

export type CallbackOutcome =
  | { kind: "confirmed"; orderId: string }
  | { kind: "rejected"; orderId: string }
  | { kind: "edit_link"; orderId: string }
  | { kind: "already"; status: string }
  | { kind: "denied" }
  | { kind: "error"; message: string }
  | { kind: "ignored" };

async function actorByTelegram(db: AnyPgDatabase, telegramUserId: number): Promise<AppUser | null> {
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.telegramUserId, telegramUserId), eq(profiles.isActive, true)));
  if (!row || (row.role !== "owner" && row.role !== "manager")) return null;
  return {
    id: row.id,
    email: null,
    fullName: row.fullName,
    role: row.role,
    locationId: row.locationId,
    locationName: null,
  };
}

/** Натискання кнопки під чернеткою. Усі відповіді користувачу йдуть через `answerCallbackQuery`. */
export async function handleCallback(
  db: AnyPgDatabase,
  callback: TgCallback,
  deps: FlowDeps = {},
): Promise<CallbackOutcome> {
  const telegram = withSender(db, deps);
  const alert = (text: string) =>
    safely(() => telegram.answer({ callbackQueryId: callback.id, text }));

  const parsed = parseCallbackData(callback.data);
  if (!parsed) {
    await alert("Невідома дія.");
    return { kind: "ignored" };
  }
  const actor = await actorByTelegram(db, callback.from.id);
  if (!actor) {
    await alert("Немає доступу.");
    return { kind: "denied" };
  }
  const [order] = await db.select().from(orders).where(eq(orders.id, parsed.orderId));
  if (!order || order.deletedAt) {
    await alert("Заявку вже відхилено.");
    return { kind: "already", status: "deleted" };
  }
  const editMessage = (text: string) =>
    callback.message
      ? safely(() =>
          telegram.edit({
            chatId: callback.message!.chat.id,
            messageId: callback.message!.message_id,
            text,
          }),
        )
      : Promise.resolve();
  const settle = (status: "confirmed" | "rejected") =>
    db
      .update(intakeMessages)
      .set({ parseStatus: status })
      .where(eq(intakeMessages.orderId, order.id));

  if (parsed.action === "edit") {
    const base = await getPublicUrl(db);
    await alert("Відкрийте форму в CRM.");
    if (callback.message) {
      const { chat, message_id: replyTo, message_thread_id: threadId } = callback.message;
      await safely(() =>
        telegram.send({
          chatId: chat.id,
          threadId,
          replyToMessageId: replyTo,
          text: `Виправте чернетку № ${order.number ?? ""} у CRM: ${base}/orders/${order.id}/edit`,
        }),
      );
    }
    return { kind: "edit_link", orderId: order.id };
  }

  if (order.status !== "draft") {
    // Повторне натискання: нічого не міняємо, лише прибираємо застарілі кнопки.
    await alert(`Уже підтверджено № ${order.number ?? ""}`.trim());
    await editMessage(`Підтверджено № ${order.number ?? ""}`.trim());
    return { kind: "already", status: order.status };
  }

  if (parsed.action === "reject") {
    try {
      await deleteDraftOrder(db, actor, order.id);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      await alert("Уже підтверджено або змінено.");
      return { kind: "already", status: "changed" };
    }
    await settle("rejected");
    await alert("Відхилено.");
    await editMessage(`Відхилено: чернетка № ${order.number ?? ""}.`.replace(" .", "."));
    return { kind: "rejected", orderId: order.id };
  }

  try {
    await transitionOrder(db, actor, order.id, "confirmed");
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    // «Статус уже змінився» означає, що хтось встиг раніше: це не помилка введення.
    const message = error.message.includes("вже змінився")
      ? `Уже підтверджено № ${order.number ?? ""}`.trim()
      : error.message;
    await alert(message);
    return error.message.includes("вже змінився")
      ? { kind: "already", status: "changed" }
      : { kind: "error", message: error.message };
  }
  await settle("confirmed");
  notifyOrderChange(db, order.id);
  const [location] = await db.select().from(locations).where(eq(locations.id, order.locationId));
  await alert("Підтверджено.");
  await editMessage(
    `Підтверджено № ${order.number ?? ""}${location ? `, у виробництві ${location.name}` : ""}`.trim(),
  );
  return { kind: "confirmed", orderId: order.id };
}

export type { DraftBuild };
