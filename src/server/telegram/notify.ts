import { after } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { clients, orders, profiles } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { formatIsoDate } from "@/utils/isoDate";
import { getPublicUrl } from "../box-labels";
import { kyivDay } from "../intake/prompt";
import { getTelegramToken, sendMessage } from "./client";

/**
 * Повідомлення менеджерам у приватний чат Telegram (B11, ТЗ 8.3, D149). Надсилаємо лише тим, хто
 * прив'язав Telegram; той, хто сам зробив дію, свого повідомлення не отримує. Збій Telegram ніколи
 * не ламає дію користувача: усе йде після відповіді й помилки ковтаються.
 *
 * Чат із користувачем має той самий номер, що й його Telegram-ідентифікатор.
 */

export type DirectSender = (chatId: number, text: string) => Promise<unknown>;

export type NotifyDeps = { send?: DirectSender };

/** Виконує завдання після відповіді користувачу; поза запитом (скрипти, тести) просто запускає. */
function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

function senderFor(db: AnyPgDatabase, deps: NotifyDeps): DirectSender | null {
  if (deps.send) return deps.send;
  if (!getTelegramToken()) return null;
  return (chatId, text) => sendMessage(db, { chatId, text });
}

/** Прив'язані до Telegram активні користувачі з цього списку (без виключених). */
async function linkedChats(
  db: AnyPgDatabase,
  profileIds: readonly string[],
  excludeId?: string,
): Promise<number[]> {
  const ids = [...new Set(profileIds)].filter((id) => id !== excludeId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ telegramUserId: profiles.telegramUserId })
    .from(profiles)
    .where(
      and(
        inArray(profiles.id, ids),
        eq(profiles.isActive, true),
        isNotNull(profiles.telegramUserId),
      ),
    );
  return rows.map((row) => row.telegramUserId!).filter((id) => Number.isFinite(id));
}

/** Усі власники й менеджери з активним обліковим записом. */
async function officeIds(db: AnyPgDatabase): Promise<string[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.role, ["owner", "manager"]), eq(profiles.isActive, true)));
  return rows.map((row) => row.id);
}

async function deliver(
  db: AnyPgDatabase,
  profileIds: readonly string[],
  text: string,
  deps: NotifyDeps,
  excludeId?: string,
): Promise<number> {
  const send = senderFor(db, deps);
  if (!send) return 0;
  const chats = await linkedChats(db, profileIds, excludeId);
  let sent = 0;
  for (const chatId of chats) {
    try {
      await send(chatId, text);
      sent += 1;
    } catch {
      // Користувач міг заблокувати бота: інших це не стосується.
    }
  }
  return sent;
}

type OrderFacts = {
  id: string;
  number: number | null;
  status: string;
  orderDate: string;
  kg: number;
  clientName: string;
  isPlaceholder: boolean;
  clientManagerId: string | null;
};

async function loadFacts(db: AnyPgDatabase, orderId: string): Promise<OrderFacts | null> {
  const [row] = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      orderDate: orders.orderDate,
      kg: orders.kgSold,
      clientName: clients.name,
      isPlaceholder: clients.isPlaceholder,
      clientManagerId: clients.managerId,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(eq(orders.id, orderId));
  return row ? { ...row, kg: Number(row.kg) } : null;
}

const kgText = (kg: number) => (kg > 0 ? `, ${kg.toLocaleString("uk-UA")} кг` : "");
const link = (base: string, id: string) => `${base}/orders/${id}`;

// ---------------------------------------------------------------------------------------------
// Події
// ---------------------------------------------------------------------------------------------

/** Нова заявка з сайту: власникам і менеджерам (клієнта часто ще не визначено). */
export async function sendSiteLeadNotice(
  db: AnyPgDatabase,
  orderId: string,
  deps: NotifyDeps = {},
): Promise<number> {
  const facts = await loadFacts(db, orderId);
  if (!facts) return 0;
  const base = await getPublicUrl(db);
  const who = facts.isPlaceholder ? "клієнта ще не визначено" : facts.clientName;
  const text = `Нова заявка з сайту № ${facts.number ?? "—"}: ${who}${kgText(facts.kg)}. Перевірте чернетку: ${link(base, orderId)}`;
  // Клієнт відомий: сповіщаємо його менеджера й власників; невідомий: усіх з офісу.
  const recipients = facts.isPlaceholder || !facts.clientManagerId ? await officeIds(db) : null;
  if (recipients) return deliver(db, recipients, text, deps);
  const owners = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "owner"), eq(profiles.isActive, true)));
  return deliver(db, [facts.clientManagerId!, ...owners.map((o) => o.id)], text, deps);
}

/** Чернетка без визначеного клієнта: автору заявки, щоб обрав клієнта. */
export async function sendNoClientNotice(
  db: AnyPgDatabase,
  orderId: string,
  telegramUserId: number,
  deps: NotifyDeps = {},
): Promise<boolean> {
  const facts = await loadFacts(db, orderId);
  if (!facts || !facts.isPlaceholder) return false;
  const send = senderFor(db, deps);
  if (!send) return false;
  const base = await getPublicUrl(db);
  try {
    await send(
      telegramUserId,
      `Чернетка № ${facts.number ?? "—"} без клієнта: оберіть клієнта, інакше її не підтвердити. ${link(base, orderId)}/edit`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Замовлення підтверджено: менеджеру клієнта, якщо підтвердив хтось інший. */
export async function sendConfirmedNotice(
  db: AnyPgDatabase,
  orderId: string,
  actorId: string,
  deps: NotifyDeps = {},
): Promise<number> {
  const facts = await loadFacts(db, orderId);
  if (!facts || facts.isPlaceholder || !facts.clientManagerId) return 0;
  if (facts.clientManagerId === actorId) return 0;
  const base = await getPublicUrl(db);
  const text = `Підтверджено замовлення № ${facts.number ?? "—"} вашого клієнта ${facts.clientName}${kgText(facts.kg)}, на ${formatIsoDate(facts.orderDate)}. ${link(base, orderId)}`;
  return deliver(db, [facts.clientManagerId], text, deps, actorId);
}

/** Замовлення на сьогодні змінили: менеджеру клієнта, якщо змінив хтось інший. */
export async function sendChangedTodayNotice(
  db: AnyPgDatabase,
  orderId: string,
  actorId: string,
  deps: NotifyDeps & { now?: Date } = {},
): Promise<number> {
  const facts = await loadFacts(db, orderId);
  if (!facts || facts.isPlaceholder || !facts.clientManagerId) return 0;
  if (facts.clientManagerId === actorId || facts.status === "draft") return 0;
  if (facts.orderDate !== kyivDay(deps.now ?? new Date())) return 0;
  const base = await getPublicUrl(db);
  const text = `Змінено замовлення № ${facts.number ?? "—"} на сьогодні: ${facts.clientName}${kgText(facts.kg)}. ${link(base, orderId)}`;
  return deliver(db, [facts.clientManagerId], text, deps, actorId);
}

// ---------------------------------------------------------------------------------------------
// Запуск після відповіді
// ---------------------------------------------------------------------------------------------

export function notifySiteLead(db: AnyPgDatabase, orderId: string): void {
  runAfterResponse(() => sendSiteLeadNotice(db, orderId));
}

export function notifyOrderConfirmed(db: AnyPgDatabase, orderId: string, actorId: string): void {
  runAfterResponse(() => sendConfirmedNotice(db, orderId, actorId));
}

export function notifyOrderChangedToday(db: AnyPgDatabase, orderId: string, actorId: string): void {
  runAfterResponse(() => sendChangedTodayNotice(db, orderId, actorId));
}
