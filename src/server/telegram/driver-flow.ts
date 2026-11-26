import { and, eq } from "drizzle-orm";
import { profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { formatMoney } from "@/utils/formatNumber";
import { formatPhone } from "@/utils/phone";
import { mapSearchUrl } from "@/utils/mapLinks";
import {
  type DriverOrder,
  driverMarkDelivered,
  driverRecordCash,
  listDriverOrders,
} from "../driver";
import { ForbiddenError, type AppUser } from "../guards";
import { ValidationError } from "../errors";
import { canDeliverOrders } from "../permissions";
import type { TgCallback } from "../intake/telegram-flow";
import { answerCallbackQuery, sendMessage } from "./client";
import { clearSession, getSession, setSession } from "./sessions";

/**
 * Бот водія (B12, ТЗ 6.13, 8.2, D179–D184): `/today` показує доставки дня, «Доставив» ставить
 * «Відправлено» й питає про готівку, відповідь водія стає записом готівки. Водій у веб не входить.
 */

export type DriverDeps = {
  send?: (params: Parameters<typeof sendMessage>[1]) => Promise<unknown>;
  answer?: (params: Parameters<typeof answerCallbackQuery>[1]) => Promise<unknown>;
  now?: Date;
};

const CASH_STATE = "driver_cash";

async function safely(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    // Відповідь у Telegram не вдалась: дані вже збережені.
  }
}

export async function driverByTelegram(
  db: AnyPgDatabase,
  telegramUserId: number,
): Promise<AppUser | null> {
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.telegramUserId, telegramUserId), eq(profiles.isActive, true)));
  if (!row || !canDeliverOrders(row.role) || !row.locationId) return null;
  return {
    id: row.id,
    email: null,
    fullName: row.fullName,
    role: row.role,
    locationId: row.locationId,
    locationName: null,
  };
}

const cbData = (orderId: string, action: "done" | "cash" | "nocash") => `drv:${orderId}:${action}`;

export function parseDriverCallback(
  data: string | undefined,
): { orderId: string; action: "done" | "cash" | "nocash" } | null {
  const match =
    /^drv:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(done|cash|nocash)$/i.exec(
      data ?? "",
    );
  return match ? { orderId: match[1]!, action: match[2] as "done" | "cash" | "nocash" } : null;
}

/** Текст картки доставки для водія: без цін, лише що везти, куди, кому дзвонити і скільки взяти готівкою. */
export function driverCardText(order: DriverOrder): string {
  const lines = [`№${order.number ?? "—"} · ${order.clientName}`];
  lines.push(`Куди: ${order.place}`);
  if (order.mapQuery) lines.push(`Карта: ${mapSearchUrl(order.mapQuery)}`);
  if (order.timeWindow) lines.push(`Коли: ${order.timeWindow}`);
  lines.push(`Скільки: ${order.kg.toLocaleString("uk-UA")} кг`);
  const who = [order.recipientName, order.recipientPhone ? formatPhone(order.recipientPhone) : null]
    .filter(Boolean)
    .join(", ");
  if (who) lines.push(`Отримувач: ${who}`);
  if (order.comment) lines.push(`Коментар: ${order.comment}`);
  lines.push(
    order.cashDue
      ? `Готівка: очікується ${formatMoney(Number(order.cashDue))}`
      : "Готівка: не потрібна",
  );
  if (order.status === "shipped") lines.push("Статус: доставлено ✅");
  else if (!order.canDeliver) lines.push("Статус: ще готують");
  return lines.join("\n");
}

function cardButtons(order: DriverOrder) {
  if (order.canDeliver) return [[{ text: "Доставив", callbackData: cbData(order.id, "done") }]];
  if (order.status === "shipped" && order.cashDue) {
    return [[{ text: "Внести готівку", callbackData: cbData(order.id, "cash") }]];
  }
  return undefined;
}

async function showToday(
  db: AnyPgDatabase,
  driver: AppUser,
  chatId: number,
  send: NonNullable<DriverDeps["send"]>,
): Promise<void> {
  const list = await listDriverOrders(db, driver);
  if (list.length === 0) {
    await safely(() => send({ chatId, text: "На сьогодні доставок немає." }));
    return;
  }
  await safely(() =>
    send({ chatId, text: `Доставки на сьогодні: ${list.length}. Нижче по одній картці.` }),
  );
  for (const order of list) {
    await safely(() => send({ chatId, text: driverCardText(order), buttons: cardButtons(order) }));
  }
}

async function askCash(
  db: AnyPgDatabase,
  telegramUserId: number,
  chatId: number,
  orderId: string,
  due: string | null,
  send: NonNullable<DriverDeps["send"]>,
  now: Date,
): Promise<void> {
  await setSession(db, telegramUserId, CASH_STATE, { orderId }, now);
  await safely(() =>
    send({
      chatId,
      text: `Скільки готівки отримали?${due ? ` Очікується ${formatMoney(Number(due))}.` : ""}`,
      forceReply: "Сума в гривнях, наприклад 450",
    }),
  );
}

/** Особисте повідомлення від прив'язаного водія. Повертає, що зробили (для тестів і журналу). */
export async function handleDriverMessage(
  db: AnyPgDatabase,
  driver: AppUser,
  from: { id: number },
  chatId: number,
  text: string,
  deps: DriverDeps = {},
): Promise<"today" | "cash" | "cash_error" | "hint"> {
  const send = deps.send ?? ((params) => sendMessage(db, params));
  const now = deps.now ?? new Date();
  const command = /^\/(\w+)(?:@\w+)?/.exec(text)?.[1]?.toLowerCase();

  if (command === "today" || command === "start" || text === "Мої доставки") {
    await clearSession(db, from.id);
    await showToday(db, driver, chatId, send);
    return "today";
  }

  const session = await getSession(db, from.id, now);
  if (session?.state === CASH_STATE && typeof session.payload.orderId === "string") {
    try {
      const result = await driverRecordCash(db, driver, session.payload.orderId, text);
      await clearSession(db, from.id);
      const left = Number(result.remainingSum);
      await safely(() =>
        send({
          chatId,
          text: result.settled
            ? "Записано. Замовлення оплачене ✅"
            : `Записано. Ще не прийнято ${formatMoney(left)}. Додати ще: /today і «Внести готівку».`,
        }),
      );
      return "cash";
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ForbiddenError) {
        // Діалог лишається: водій може виправити суму.
        await safely(() =>
          send({
            chatId,
            text: `${error.message}\nНапишіть суму ще раз або /today, щоб вийти.`,
            forceReply: "Сума в гривнях, наприклад 450",
          }),
        );
        return "cash_error";
      }
      throw error;
    }
  }

  await safely(() => send({ chatId, text: "Я показую доставки дня. Напишіть /today." }));
  return "hint";
}

/** Кнопки водія: `drv:<id>:done|cash|nocash`. Чужа локація, повторні й застарілі натискання нічого не ламають. */
export async function handleDriverCallback(
  db: AnyPgDatabase,
  callback: TgCallback,
  deps: DriverDeps = {},
): Promise<string> {
  const send = deps.send ?? ((params) => sendMessage(db, params));
  const answer = deps.answer ?? ((params) => answerCallbackQuery(db, params));
  const now = deps.now ?? new Date();
  const alert = (text: string) => safely(() => answer({ callbackQueryId: callback.id, text }));

  const parsed = parseDriverCallback(callback.data);
  if (!parsed) {
    await alert("Невідома дія.");
    return "ignored";
  }
  const driver = await driverByTelegram(db, callback.from.id);
  if (!driver) {
    await alert("Немає доступу.");
    return "denied";
  }
  const chatId = callback.message?.chat.id ?? callback.from.id;

  try {
    if (parsed.action === "nocash") {
      await clearSession(db, callback.from.id);
      await alert("Добре, готівки немає.");
      return "nocash";
    }
    if (parsed.action === "cash") {
      const [order] = (await listDriverOrders(db, driver)).filter((o) => o.id === parsed.orderId);
      if (!order || order.status !== "shipped" || !order.cashDue) {
        await alert("Готівку по цьому замовленню вже не очікуємо.");
        return "already";
      }
      await alert("Вкажіть суму.");
      await askCash(db, callback.from.id, chatId, parsed.orderId, order.cashDue, send, now);
      return "cash";
    }
    const result = await driverMarkDelivered(db, driver, parsed.orderId);
    if (result.already) {
      await alert("Уже відмічено як доставлене.");
      return "already";
    }
    await alert("Відмічено: доставлено ✅");
    if (result.askCash) {
      await safely(() =>
        send({
          chatId,
          text: "Готівку не брали?",
          buttons: [[{ text: "Готівку не брали", callbackData: cbData(parsed.orderId, "nocash") }]],
        }),
      );
      await askCash(db, callback.from.id, chatId, parsed.orderId, result.cashDue, send, now);
    }
    return "delivered";
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      await alert(error.message);
      return "error";
    }
    throw error;
  }
}
