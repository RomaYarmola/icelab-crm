import { and, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { clientStatuses, clients, orders, profiles, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { z } from "zod";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import {
  daysBetween,
  DEFAULT_INACTIVE_DAYS,
  inactiveThreshold,
  type Threshold,
} from "./inactive-rules";
import { SUMMARY_STATUSES } from "./month-summary";

/**
 * «Давно не замовляли» (B14, ТЗ 6.11, 7.7, D207, D208): клієнти зі статусом «Активний», не разові,
 * чиє останнє підтверджене замовлення старше за поріг. Хто ще не замовляв, у список не йде; якщо є
 * замовлення на майбутню дату, клієнт не «зник». Менеджер бачить своїх клієнтів. Цей самий список
 * далі використовують ранкові нагадування.
 */

export const INACTIVE_DAYS_KEY = "client.inactive_days_default";

export type InactiveClient = {
  clientId: string;
  clientName: string;
  clientCode: string;
  managerId: string | null;
  managerName: string | null;
  lastOrderDate: string;
  days: number;
  threshold: Threshold;
};

export async function loadInactiveDays(db: AnyPgDatabase): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, INACTIVE_DAYS_KEY))
    .limit(1);
  const value = row?.value;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_INACTIVE_DAYS;
}

/** Усі клієнти, які давно не замовляли, без перевірки прав: для нагадувань і екрана. */
export async function findInactiveClients(
  db: AnyPgDatabase,
  options: { now?: Date; managerId?: string | null } = {},
): Promise<InactiveClient[]> {
  const today = todayIso(options.now);
  const general = await loadInactiveDays(db);
  const candidates = await db
    .select({
      id: clients.id,
      name: clients.name,
      code: clients.code,
      managerId: clients.managerId,
      managerName: profiles.fullName,
      own: clients.inactiveDaysThreshold,
    })
    .from(clients)
    .innerJoin(clientStatuses, eq(clientStatuses.id, clients.statusId))
    .leftJoin(profiles, eq(profiles.id, clients.managerId))
    .where(
      and(
        eq(clientStatuses.code, "active"),
        isNull(clients.deletedAt),
        eq(clients.isPlaceholder, false),
        eq(clients.isOneTime, false),
        ...(options.managerId ? [eq(clients.managerId, options.managerId)] : []),
      ),
    );
  if (candidates.length === 0) return [];
  const history = await db
    .select({ clientId: orders.clientId, orderDate: orders.orderDate })
    .from(orders)
    .where(
      and(
        inArray(
          orders.clientId,
          candidates.map((client) => client.id),
        ),
        inArray(orders.status, [...SUMMARY_STATUSES]),
        isNull(orders.deletedAt),
      ),
    );
  const dates = new Map<string, string[]>();
  for (const row of history) {
    const list = dates.get(row.clientId);
    if (list) list.push(row.orderDate);
    else dates.set(row.clientId, [row.orderDate]);
  }

  const result: InactiveClient[] = [];
  for (const client of candidates) {
    const own = dates.get(client.id);
    if (!own) continue;
    const last = own.reduce((max, date) => (date > max ? date : max), own[0]!);
    const days = daysBetween(last, today);
    const threshold = inactiveThreshold(client.own, own, general);
    if (days <= threshold.days) continue;
    result.push({
      clientId: client.id,
      clientName: client.name,
      clientCode: client.code,
      managerId: client.managerId,
      managerName: client.managerName,
      lastOrderDate: last,
      days,
      threshold,
    });
  }
  // Спершу ті, хто «найбільше прострочив» свій поріг.
  return result.sort(
    (a, b) =>
      b.days - b.threshold.days - (a.days - a.threshold.days) ||
      a.clientName.localeCompare(b.clientName, "uk"),
  );
}

/** Список для екрана: власник і бухгалтер бачать усіх, менеджер лише своїх. */
export async function listInactiveClients(
  db: AnyPgDatabase,
  actor: AppUser,
  now?: Date,
): Promise<InactiveClient[]> {
  requirePermission(actor, "analytics", "read");
  return findInactiveClients(db, {
    now,
    managerId: actor.role === "manager" ? actor.id : null,
  });
}

/** «Позначити разовим» і зняти позначку: хто може змінювати картки клієнтів (власник і менеджер). */
export async function setClientOneTime(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  value: boolean,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(z.string().uuid("Некоректний ідентифікатор."), clientId);
  const [client] = await db
    .select({ deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!client || client.deletedAt) throw new ValidationError("Клієнта не знайдено.");
  await withActor(db, actor.id, (tx) =>
    tx.update(clients).set({ isOneTime: value }).where(eq(clients.id, id)),
  );
}

/** Загальний поріг «давно не замовляв» задає власник. */
export async function setInactiveDays(
  db: AnyPgDatabase,
  actor: AppUser,
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
      .where(eq(settings.key, INACTIVE_DAYS_KEY));
    if (existing) {
      await tx.update(settings).set({ value: days }).where(eq(settings.key, INACTIVE_DAYS_KEY));
    } else await tx.insert(settings).values({ key: INACTIVE_DAYS_KEY, value: days });
  });
}
