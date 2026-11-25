import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import {
  boxes,
  clients,
  locations,
  payments,
  profiles,
  reminders,
  settings,
  shipmentReturns,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { z } from "zod";
import { getPublicUrl } from "./box-labels";
import { daysAtClient } from "./boxes";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { findInactiveClients } from "./inactive";
import {
  DEFAULT_BOX_REMINDER_DAYS,
  DEFAULT_REMINDERS_TIME,
  DEFAULT_RETURN_REMINDER_DAYS,
  describeReminder,
  formatReminderMessage,
  REPEAT_DAYS,
  type ReminderLine,
} from "./reminder-rules";
import { can } from "./permissions";
import { claimDay } from "./telegram/day-claim";
import { getTelegramToken, sendMessage } from "./telegram/client";
import { kyivTime } from "./telegram/daily-report";

/**
 * Ранкові нагадування (B14, ТЗ 7.7, D209, D210). Раз на київський день (не раніше 09:00):
 *  - клієнт давно не замовляв: менеджеру клієнта, без менеджера власникам;
 *  - бокси довго в клієнта: так само;
 *  - є нерозпізнані платежі: бухгалтерам (без них власникам), раз на день;
 *  - повернення боксу чекає на пошті 3 дні й довше (B17, D226): власникам, менеджерам, старшим
 *    локації й виробництву свого міста, раз на день, доки не заберуть.
 * Про клієнта й бокси не частіше ніж раз на 7 днів. У списку показуємо лише те, що ще актуальне:
 * клієнт замовив, бокс повернули чи чергу розібрали: нагадування зникає саме. Клієнтам нічого не
 * надсилаємо.
 */

export const BOX_DAYS_KEY = "box.reminder_days";
export const RETURN_DAYS_KEY = "box.return_days";
const TIME_KEY = "report.reminders_time";
const STATE_KEY = "reminders";
const DAY_MS = 86_400_000;

async function readSetting(db: AnyPgDatabase, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value;
}

async function loadDays(db: AnyPgDatabase, key: string, fallback: number): Promise<number> {
  const value = await readSetting(db, key);
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export const loadBoxReminderDays = (db: AnyPgDatabase) =>
  loadDays(db, BOX_DAYS_KEY, DEFAULT_BOX_REMINDER_DAYS);

export const loadReturnReminderDays = (db: AnyPgDatabase) =>
  loadDays(db, RETURN_DAYS_KEY, DEFAULT_RETURN_REMINDER_DAYS);

export async function loadRemindersTime(db: AnyPgDatabase): Promise<string> {
  const value = await readSetting(db, TIME_KEY);
  const text = typeof value === "string" ? value.trim() : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : DEFAULT_REMINDERS_TIME;
}

async function saveDays(
  db: AnyPgDatabase,
  actor: AppUser,
  key: string,
  days: number,
): Promise<void> {
  requirePermission(actor, "migration_settings", "write");
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new ValidationError("Вкажіть кількість днів цілим числом від 1 до 3650.");
  }
  await withActor(db, actor.id, async (tx) => {
    const [existing] = await tx
      .select({ key: settings.key })
      .from(settings)
      .where(eq(settings.key, key));
    if (existing) await tx.update(settings).set({ value: days }).where(eq(settings.key, key));
    else await tx.insert(settings).values({ key, value: days });
  });
}

export const setBoxReminderDays = (db: AnyPgDatabase, actor: AppUser, days: number) =>
  saveDays(db, actor, BOX_DAYS_KEY, days);

export const setReturnReminderDays = (db: AnyPgDatabase, actor: AppUser, days: number) =>
  saveDays(db, actor, RETURN_DAYS_KEY, days);

// ---------------------------------------------------------------------------------------------
// Поточний стан: що зараз варте нагадування
// ---------------------------------------------------------------------------------------------

export type OverdueBoxes = {
  clientId: string;
  clientName: string;
  managerId: string | null;
  count: number;
  /** Найдавніший бокс і скільки днів він у клієнта. */
  oldestBoxId: string;
  days: number;
};

/** Клієнти, у яких боксів (з наклейками) «У клієнта» довше порогу. */
export async function findOverdueBoxes(
  db: AnyPgDatabase,
  now: Date = new Date(),
): Promise<OverdueBoxes[]> {
  const threshold = await loadBoxReminderDays(db);
  const rows = await db
    .select({
      boxId: boxes.id,
      issuedAt: boxes.issuedAt,
      clientId: clients.id,
      clientName: clients.name,
      managerId: clients.managerId,
    })
    .from(boxes)
    .innerJoin(clients, eq(clients.id, boxes.currentClientId))
    .where(and(eq(boxes.status, "at_client"), isNotNull(boxes.issuedAt)))
    .orderBy(asc(boxes.issuedAt));
  const today = Date.parse(`${todayIso(now)}T00:00:00Z`);
  const result = new Map<string, OverdueBoxes>();
  for (const row of rows) {
    const issued = Date.parse(`${todayIso(row.issuedAt!)}T00:00:00Z`);
    const days = Math.round((today - issued) / DAY_MS);
    if (days <= threshold) continue;
    const entry = result.get(row.clientId);
    if (entry) entry.count += 1;
    else {
      result.set(row.clientId, {
        clientId: row.clientId,
        clientName: row.clientName,
        managerId: row.managerId,
        count: 1,
        oldestBoxId: row.boxId,
        days,
      });
    }
  }
  return [...result.values()];
}

async function countUnmatched(db: AnyPgDatabase): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.matchStatus, "unmatched"));
  return row?.n ?? 0;
}

export type WaitingReturn = { locationId: string; locationName: string; days: number };

/** Повернення боксів, що чекають на відділенні не менше порогу (B17, D226). */
export async function findWaitingReturns(
  db: AnyPgDatabase,
  now: Date = new Date(),
): Promise<WaitingReturn[]> {
  const threshold = await loadReturnReminderDays(db);
  const rows = await db
    .select({
      locationId: locations.id,
      locationName: locations.name,
      arrivedAt: shipmentReturns.arrivedAt,
    })
    .from(shipmentReturns)
    .innerJoin(locations, eq(locations.id, shipmentReturns.locationId))
    .where(
      and(
        eq(shipmentReturns.status, "arrived"),
        isNull(shipmentReturns.closedAt),
        isNotNull(shipmentReturns.arrivedAt),
      ),
    )
    .orderBy(asc(locations.name));
  return rows
    .map(({ arrivedAt, ...row }) => ({ ...row, days: daysAtClient(arrivedAt!, now) }))
    .filter((row) => row.days >= threshold);
}

/** Рядок нагадування для людини: з локацією лише своє місто; нічого не чекає, то `null`. */
function returnLine(waiting: WaitingReturn[], locationId: string | null): ReminderLine | null {
  const own = locationId ? waiting.filter((item) => item.locationId === locationId) : waiting;
  if (own.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of own) counts.set(item.locationName, (counts.get(item.locationName) ?? 0) + 1);
  return {
    kind: "box_return_waiting",
    places: [...counts].map(([name, count]) => ({ name, count })),
    days: Math.max(...own.map((item) => item.days)),
  };
}

// ---------------------------------------------------------------------------------------------
// Складання
// ---------------------------------------------------------------------------------------------

async function recipients(db: AnyPgDatabase) {
  const rows = await db
    .select({ id: profiles.id, role: profiles.role, locationId: profiles.locationId })
    .from(profiles)
    .where(eq(profiles.isActive, true));
  const owners = rows.filter((p) => p.role === "owner").map((p) => p.id);
  const accountants = rows.filter((p) => p.role === "accountant").map((p) => p.id);
  const active = new Set(
    rows.filter((p) => p.role === "manager" || p.role === "owner").map((p) => p.id),
  );
  return {
    /** Менеджер клієнта, а коли його немає (чи він вимкнений), власники. */
    forClient: (managerId: string | null) =>
      managerId && active.has(managerId) ? [managerId] : owners,
    forPayments: accountants.length > 0 ? accountants : owners,
    /** Власники й менеджери, а старші локації й виробництво з локацією, де щось чекає. */
    forReturns: (waiting: WaitingReturn[]) =>
      rows
        .filter((p) => {
          if (p.role === "owner" || p.role === "manager") return waiting.length > 0;
          if (p.role !== "location_lead" && p.role !== "production") return false;
          return waiting.some((item) => item.locationId === p.locationId);
        })
        .map((p) => p.id),
  };
}

export type ReminderKind = ReminderLine["kind"];

type Draft = {
  kind: ReminderKind;
  clientId: string | null;
  boxId: string | null;
  assigneeId: string;
};

/**
 * Створює нагадування на сьогодні (ідемпотентно). Про клієнта й бокси пропускає, якщо те саме вже
 * нагадували менш ніж 7 днів тому (навіть якщо людина відклала). Повертає ідентифікатори нових.
 */
export async function generateReminders(
  db: AnyPgDatabase,
  now: Date = new Date(),
): Promise<string[]> {
  const day = todayIso(now);
  const to = await recipients(db);
  const [inactive, overdue, unmatched, waiting] = await Promise.all([
    findInactiveClients(db, { now }),
    findOverdueBoxes(db, now),
    countUnmatched(db),
    findWaitingReturns(db, now),
  ]);

  const drafts: Draft[] = [];
  for (const client of inactive) {
    for (const assigneeId of to.forClient(client.managerId)) {
      drafts.push({ kind: "client_inactive", clientId: client.clientId, boxId: null, assigneeId });
    }
  }
  for (const item of overdue) {
    for (const assigneeId of to.forClient(item.managerId)) {
      drafts.push({
        kind: "box_overdue",
        clientId: item.clientId,
        boxId: item.oldestBoxId,
        assigneeId,
      });
    }
  }
  if (unmatched > 0) {
    for (const assigneeId of to.forPayments) {
      drafts.push({ kind: "payment_unmatched", clientId: null, boxId: null, assigneeId });
    }
  }
  for (const assigneeId of to.forReturns(waiting)) {
    drafts.push({ kind: "box_return_waiting", clientId: null, boxId: null, assigneeId });
  }
  if (drafts.length === 0) return [];

  const recent = await db
    .select({
      kind: reminders.kind,
      clientId: reminders.clientId,
      assigneeId: reminders.assigneeId,
    })
    .from(reminders)
    .where(gt(reminders.dueAt, new Date(now.getTime() - REPEAT_DAYS * DAY_MS)));
  const seen = new Set(recent.map((r) => `${r.kind}:${r.clientId}:${r.assigneeId}`));

  const created: string[] = [];
  for (const draft of drafts) {
    // Про черги (платежі, посилки) нагадуємо щодня, про клієнта й бокси раз на 7 днів.
    const repeatable = draft.kind === "client_inactive" || draft.kind === "box_overdue";
    if (repeatable && seen.has(`${draft.kind}:${draft.clientId}:${draft.assigneeId}`)) continue;
    const [row] = await db
      .insert(reminders)
      .values({
        ...draft,
        dueAt: now,
        dedupeKey: `${draft.kind}:${draft.clientId ?? "queue"}:${draft.assigneeId}:${day}`,
      })
      .onConflictDoNothing()
      .returning({ id: reminders.id });
    if (row) created.push(row.id);
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Список і «Відкласти»
// ---------------------------------------------------------------------------------------------

export type ReminderView = {
  id: string;
  kind: ReminderKind;
  clientId: string | null;
  text: string;
  dueAt: Date;
};

/** Робить із записів тексти, відкидаючи неактуальні й старші повтори того самого. */
async function toViews(
  db: AnyPgDatabase,
  rows: (typeof reminders.$inferSelect)[],
  now: Date,
  /** Локація одержувача: посилки показуємо лише його міста. */
  locationId: string | null,
): Promise<ReminderView[]> {
  if (rows.length === 0) return [];
  const [inactive, overdue, unmatched, waiting] = await Promise.all([
    findInactiveClients(db, { now }),
    findOverdueBoxes(db, now),
    countUnmatched(db),
    findWaitingReturns(db, now),
  ]);
  const byInactive = new Map(inactive.map((c) => [c.clientId, c]));
  const byOverdue = new Map(overdue.map((c) => [c.clientId, c]));
  const seen = new Set<string>();
  const views: ReminderView[] = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.clientId}`;
    if (seen.has(key)) continue;
    let line: ReminderLine | null = null;
    if (row.kind === "client_inactive") {
      const c = byInactive.get(row.clientId!);
      if (c) line = { kind: row.kind, clientName: c.clientName, days: c.days };
    } else if (row.kind === "box_overdue") {
      const c = byOverdue.get(row.clientId!);
      if (c) line = { kind: row.kind, clientName: c.clientName, count: c.count, days: c.days };
    } else if (row.kind === "box_return_waiting") {
      line = returnLine(waiting, locationId);
    } else if (unmatched > 0) line = { kind: row.kind, count: unmatched };
    seen.add(key);
    if (!line) continue;
    views.push({
      id: row.id,
      kind: row.kind,
      clientId: row.clientId,
      text: describeReminder(line),
      dueAt: row.dueAt,
    });
  }
  return views;
}

/** Мої нагадування: не відкладені, за останні 30 днів і ще актуальні. Найновіші зверху. */
export async function listReminders(
  db: AnyPgDatabase,
  actor: AppUser,
  now: Date = new Date(),
): Promise<ReminderView[]> {
  requirePermission(actor, "analytics", "read");
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.assigneeId, actor.id),
        isNull(reminders.dismissedAt),
        gt(reminders.dueAt, new Date(now.getTime() - 30 * DAY_MS)),
      ),
    )
    .orderBy(desc(reminders.dueAt));
  return toViews(db, rows, now, actor.locationId);
}

/** «Відкласти»: прибирає зі свого списку всі нагадування того самого про того самого. */
export async function dismissReminder(
  db: AnyPgDatabase,
  actor: AppUser,
  reminderId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(actor, "analytics", "read");
  const id = parseInput(z.string().uuid("Некоректний ідентифікатор."), reminderId);
  const [row] = await db.select().from(reminders).where(eq(reminders.id, id));
  if (!row || row.assigneeId !== actor.id) throw new ValidationError("Нагадування не знайдено.");
  await db
    .update(reminders)
    .set({ dismissedAt: now })
    .where(
      and(
        eq(reminders.assigneeId, actor.id),
        eq(reminders.kind, row.kind),
        row.clientId ? eq(reminders.clientId, row.clientId) : isNull(reminders.clientId),
        isNull(reminders.dismissedAt),
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// Telegram і розклад
// ---------------------------------------------------------------------------------------------

export type ReminderDeps = {
  now?: Date;
  send?: (chatId: number, text: string) => Promise<unknown>;
};

/** Надсилає нові нагадування тим, хто прив'язав Telegram: одне повідомлення на людину. */
export async function sendReminders(
  db: AnyPgDatabase,
  ids: readonly string[],
  deps: ReminderDeps = {},
): Promise<number> {
  const now = deps.now ?? new Date();
  const send =
    deps.send ??
    (getTelegramToken()
      ? (chatId: number, text: string) => sendMessage(db, { chatId, text })
      : null);
  if (!send || ids.length === 0) return 0;
  const rows = await db
    .select()
    .from(reminders)
    .where(and(inArray(reminders.id, [...ids]), isNull(reminders.sentAt)));
  const people = await db
    .select({
      id: profiles.id,
      chat: profiles.telegramUserId,
      role: profiles.role,
      locationId: profiles.locationId,
    })
    .from(profiles)
    .where(and(eq(profiles.isActive, true), isNotNull(profiles.telegramUserId)));
  const base = await getPublicUrl(db);
  let sent = 0;
  for (const person of people) {
    const own = rows.filter((row) => row.assigneeId === person.id);
    if (own.length === 0) continue;
    const views = await toViews(db, own, now, person.locationId);
    if (views.length === 0) continue;
    // Старший локації й виробництво аналітики не бачать: їм одразу список посилок.
    const onlyReturns = views.every((view) => view.kind === "box_return_waiting");
    const path =
      onlyReturns || !can(person.role, "analytics", "read")
        ? "/boxes/returns"
        : "/analytics?tab=reminders";
    try {
      await send(
        person.chat!,
        formatReminderMessage(
          views.map((view) => view.text),
          `${base}${path}`,
        ),
      );
    } catch {
      // Один недоступний чат не повинен зупиняти решту; нагадування лишається в застосунку.
      continue;
    }
    await db
      .update(reminders)
      .set({ sentAt: now })
      .where(
        inArray(
          reminders.id,
          own.map((row) => row.id),
        ),
      );
    sent += 1;
  }
  return sent;
}

export type RemindersRunResult =
  { ran: true; created: number; sent: number } | { ran: false; reason: "not_yet" | "already" };

/**
 * Один прохід розкладу: не раніше часу з налаштування й лише раз на київський день (спробу
 * «займаємо», тож два одночасні виклики не складуть двічі). Якщо щось впало, спробу звільняємо.
 */
export async function runReminders(
  db: AnyPgDatabase,
  deps: ReminderDeps = {},
): Promise<RemindersRunResult> {
  const now = deps.now ?? new Date();
  if (kyivTime(now) < (await loadRemindersTime(db))) return { ran: false, reason: "not_yet" };
  const claim = await claimDay(db, STATE_KEY, now, todayIso(now));
  if (!claim) return { ran: false, reason: "already" };
  try {
    const created = await generateReminders(db, now);
    const sent = await sendReminders(db, created, { ...deps, now });
    return { ran: true, created: created.length, sent };
  } catch (error) {
    await claim.release();
    throw error;
  }
}
