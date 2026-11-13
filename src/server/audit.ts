import { and, desc, eq, gte, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLog,
  cashEntries,
  clientAddresses,
  clientApplications,
  clientContacts,
  clientPrices,
  clients,
  clientStatuses,
  boxTypes,
  iceTypes,
  locations,
  orderItems,
  orderPriceChanges,
  orders,
  orderSources,
  profiles,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { isIsoDate } from "@/utils/isoDate";
import { normalizeClientCode } from "@/utils/clientCode";
import {
  type AuditAction,
  type AuditChange,
  type AuditDiff,
  buildChanges,
  collectRefs,
  describeAuditEntry,
  emptyNames,
} from "./audit-format";
import {
  AUDIT_SECTIONS,
  AUDIT_TABLES,
  type AuditRef,
  type AuditSection,
  tablesOfSection,
} from "./audit-labels";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { loadOrderRow } from "./orders";

/**
 * Читання журналу змін (B8, D89–D91). Журнал пише база (`audit_log`, тригери), тут його лише
 * читаємо й розкладаємо на людські речення. Дивитись журнал на екрані можуть власник і бухгалтер
 * (матриця `audit_log`); історію на картці замовлення чи клієнта мають ролі, що бачать гроші
 * (власник, менеджер, бухгалтер): старший локації й виробництво її не отримують ніде.
 */

export type AuditEntryView = {
  id: string;
  /** Коли (ISO). */
  at: string;
  /** Хто: ім'я користувача або «Система». */
  actorName: string;
  action: AuditAction;
  sectionLabel: string;
  tableLabel: string;
  /** Про що запис: «Замовлення № 3472 · Кафе «Вогник»». */
  subject: string;
  /** Куди веде посилання на запис, якщо він ще є. */
  href: string | null;
  /** Одне речення: «Змінено статус: Підтверджено → У виробництві». */
  summary: string;
  changes: AuditChange[];
};

export type AuditPage = { items: AuditEntryView[]; hasMore: boolean };

export const AUDIT_PAGE_SIZE = 30;
const HISTORY_LIMIT = 50;
const SYSTEM_NAME = "Система";

const uuid = z.string().uuid("Некоректний ідентифікатор.");

type AuditRow = typeof auditLog.$inferSelect;

export type AuditFilters = {
  section?: AuditSection;
  actorId?: string;
  /** Дата «від» за київським часом, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  /** Номер замовлення (цифри) чи код клієнта. */
  search?: string;
};

// ---------------------------------------------------------------------------------------------
// Які рядки журналу стосуються одного замовлення чи клієнта
// ---------------------------------------------------------------------------------------------

type Entity = { kind: "order" | "client"; id: string };

/** Ідентифікатори пов'язаних рядків, у яких у журналі є посилання на батька (навіть видалені). */
async function relatedIds(
  db: AnyPgDatabase,
  table: string,
  column: string,
  parentId: string,
  current: string[],
): Promise<string[]> {
  const derived = await db
    .selectDistinct({ id: auditLog.rowId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tableName, table),
        sql`((${auditLog.diff} -> ${sql.raw(`'${column}'`)} ->> 'old') = ${parentId} or (${auditLog.diff} -> ${sql.raw(`'${column}'`)} ->> 'new') = ${parentId})`,
      ),
    );
  return [...new Set([...current, ...derived.map((row) => row.id)])];
}

const inTable = (table: string, ids: string[]): SQL | undefined =>
  ids.length > 0 ? and(eq(auditLog.tableName, table), inArray(auditLog.rowId, ids)) : undefined;

/** Умова на `audit_log`: усе, що стосується замовлення (позиції, зміни ціни, готівка) чи клієнта. */
async function entityCondition(db: AnyPgDatabase, entity: Entity): Promise<SQL | undefined> {
  if (entity.kind === "order") {
    const [items, changes, cash] = await Promise.all([
      db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, entity.id)),
      db
        .select({ id: orderPriceChanges.id })
        .from(orderPriceChanges)
        .where(eq(orderPriceChanges.orderId, entity.id)),
      db.select({ id: cashEntries.id }).from(cashEntries).where(eq(cashEntries.orderId, entity.id)),
    ]);
    const itemIds = await relatedIds(
      db,
      "order_items",
      "order_id",
      entity.id,
      items.map((row) => row.id),
    );
    return or(
      and(eq(auditLog.tableName, "orders"), eq(auditLog.rowId, entity.id)),
      inTable("order_items", itemIds),
      inTable(
        "order_price_changes",
        changes.map((row) => row.id),
      ),
      inTable(
        "cash_entries",
        cash.map((row) => row.id),
      ),
    );
  }

  const [contacts, addresses, prices] = await Promise.all([
    db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, entity.id)),
    db
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, entity.id)),
    db
      .select({ id: clientPrices.id })
      .from(clientPrices)
      .where(eq(clientPrices.clientId, entity.id)),
  ]);
  const [contactIds, addressIds, priceIds] = await Promise.all([
    relatedIds(
      db,
      "client_contacts",
      "client_id",
      entity.id,
      contacts.map((row) => row.id),
    ),
    relatedIds(
      db,
      "client_addresses",
      "client_id",
      entity.id,
      addresses.map((row) => row.id),
    ),
    relatedIds(
      db,
      "client_prices",
      "client_id",
      entity.id,
      prices.map((row) => row.id),
    ),
  ]);
  return or(
    and(eq(auditLog.tableName, "clients"), eq(auditLog.rowId, entity.id)),
    inTable("client_contacts", contactIds),
    inTable("client_addresses", addressIds),
    inTable("client_prices", priceIds),
  );
}

// ---------------------------------------------------------------------------------------------
// Назви замість ідентифікаторів і заголовки записів
// ---------------------------------------------------------------------------------------------

type Subject = { text: string; href: string | null };

const NAME_QUERIES: Record<
  AuditRef,
  (db: AnyPgDatabase, ids: string[]) => Promise<[string, string][]>
> = {
  client: async (db, ids) =>
    (await db.select().from(clients).where(inArray(clients.id, ids))).map((row) => [
      row.id,
      `${row.code} ${row.name}`,
    ]),
  location: async (db, ids) =>
    (await db.select().from(locations).where(inArray(locations.id, ids))).map((row) => [
      row.id,
      row.name,
    ]),
  iceType: async (db, ids) =>
    (await db.select().from(iceTypes).where(inArray(iceTypes.id, ids))).map((row) => [
      row.id,
      row.name,
    ]),
  source: async (db, ids) =>
    (await db.select().from(orderSources).where(inArray(orderSources.id, ids))).map((row) => [
      row.id,
      row.name,
    ]),
  boxType: async (db, ids) =>
    (await db.select().from(boxTypes).where(inArray(boxTypes.id, ids))).map((row) => [
      row.id,
      row.name,
    ]),
  address: async (db, ids) =>
    (await db.select().from(clientAddresses).where(inArray(clientAddresses.id, ids))).map((row) => [
      row.id,
      row.label?.trim() ||
        [row.cityText, row.addressText].filter(Boolean).join(", ") ||
        "адреса без назви",
    ]),
  user: async (db, ids) =>
    (await db.select().from(profiles).where(inArray(profiles.id, ids))).map((row) => [
      row.id,
      row.fullName,
    ]),
  application: async (db, ids) =>
    (await db.select().from(clientApplications).where(inArray(clientApplications.id, ids))).map(
      (row) => [row.id, row.name],
    ),
  clientStatus: async (db, ids) =>
    (await db.select().from(clientStatuses).where(inArray(clientStatuses.id, ids))).map((row) => [
      row.id,
      row.name,
    ]),
  order: async (db, ids) =>
    (await db.select().from(orders).where(inArray(orders.id, ids))).map((row) => [
      row.id,
      `№ ${row.number ?? "—"}`,
    ]),
};

async function loadNames(db: AnyPgDatabase, wanted: Map<AuditRef, Set<string>>) {
  const names = emptyNames();
  for (const [kind, ids] of wanted) {
    const unique = [...ids].filter((id) => uuid.safeParse(id).success);
    if (unique.length === 0) continue;
    for (const [id, name] of await NAME_QUERIES[kind](db, unique)) names[kind].set(id, name);
  }
  return names;
}

const valueOf = (diff: AuditDiff, column: string): string | null => {
  const change = diff[column];
  const value = change?.new ?? change?.old;
  return typeof value === "string" ? value : null;
};

/** Заголовок і посилання кожного рядка журналу: про яке замовлення, клієнта, ціну йдеться. */
async function loadSubjects(db: AnyPgDatabase, rows: AuditRow[]): Promise<Map<string, Subject>> {
  const ids = (table: string) => [
    ...new Set(rows.filter((row) => row.tableName === table).map((row) => row.rowId)),
  ];
  const valid = (list: string[]) => list.filter((id) => uuid.safeParse(id).success);

  const itemRows = valid(ids("order_items")).length
    ? await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.id, valid(ids("order_items"))))
    : [];
  const changeRows = valid(ids("order_price_changes")).length
    ? await db
        .select()
        .from(orderPriceChanges)
        .where(inArray(orderPriceChanges.id, valid(ids("order_price_changes"))))
    : [];
  const cashRows = valid(ids("cash_entries")).length
    ? await db
        .select()
        .from(cashEntries)
        .where(inArray(cashEntries.id, valid(ids("cash_entries"))))
    : [];
  const contactRows = valid(ids("client_contacts")).length
    ? await db
        .select()
        .from(clientContacts)
        .where(inArray(clientContacts.id, valid(ids("client_contacts"))))
    : [];
  const addressRows = valid(ids("client_addresses")).length
    ? await db
        .select()
        .from(clientAddresses)
        .where(inArray(clientAddresses.id, valid(ids("client_addresses"))))
    : [];
  const priceRows = valid(ids("client_prices")).length
    ? await db
        .select()
        .from(clientPrices)
        .where(inArray(clientPrices.id, valid(ids("client_prices"))))
    : [];

  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((row) => [row.id, row]));
  const items = byId(itemRows);
  const changes = byId(changeRows);
  const cash = byId(cashRows);
  const contacts = byId(contactRows);
  const addresses = byId(addressRows);
  const prices = byId(priceRows);

  // Замовлення й клієнт кожного рядка: з самого рядка, а якщо його вже видалено, з диффу журналу.
  const orderOf = (row: AuditRow): string | null => {
    const diff = row.diff as AuditDiff;
    switch (row.tableName) {
      case "orders":
        return row.rowId;
      case "order_items":
        return items.get(row.rowId)?.orderId ?? valueOf(diff, "order_id");
      case "order_price_changes":
        return changes.get(row.rowId)?.orderId ?? valueOf(diff, "order_id");
      case "cash_entries":
        return cash.get(row.rowId)?.orderId ?? valueOf(diff, "order_id");
      default:
        return null;
    }
  };
  const clientOf = (row: AuditRow): string | null => {
    const diff = row.diff as AuditDiff;
    switch (row.tableName) {
      case "clients":
        return row.rowId;
      case "client_contacts":
        return contacts.get(row.rowId)?.clientId ?? valueOf(diff, "client_id");
      case "client_addresses":
        return addresses.get(row.rowId)?.clientId ?? valueOf(diff, "client_id");
      case "client_prices":
        return prices.get(row.rowId)?.clientId ?? valueOf(diff, "client_id");
      default:
        return null;
    }
  };

  const orderIds = valid([...new Set(rows.map(orderOf).filter((id): id is string => !!id))]);
  const orderRows = orderIds.length
    ? await db.select().from(orders).where(inArray(orders.id, orderIds))
    : [];
  const orderMap = byId(orderRows);
  const clientIds = valid([
    ...new Set([
      ...rows.map(clientOf).filter((id): id is string => !!id),
      ...orderRows.map((row) => row.clientId),
    ]),
  ]);
  const clientRows = clientIds.length
    ? await db.select().from(clients).where(inArray(clients.id, clientIds))
    : [];
  const clientMap = byId(clientRows);

  const profileIds = valid(ids("profiles"));
  const profileRows = profileIds.length
    ? await db.select().from(profiles).where(inArray(profiles.id, profileIds))
    : [];
  const profileMap = byId(profileRows);
  const iceIds = valid(
    ids("default_prices").length
      ? [
          ...new Set(
            rows
              .filter((row) => row.tableName === "default_prices")
              .map((row) => valueOf(row.diff as AuditDiff, "ice_type_id"))
              .filter((id): id is string => !!id),
          ),
        ]
      : [],
  );
  const iceMap = new Map(
    iceIds.length
      ? (await db.select().from(iceTypes).where(inArray(iceTypes.id, iceIds))).map(
          (row) => [row.id, row.name] as const,
        )
      : [],
  );

  const orderTitle = (orderId: string | null): Subject => {
    if (!orderId) return { text: "Замовлення", href: null };
    const order = orderMap.get(orderId);
    if (!order) return { text: "Замовлення (видалено)", href: null };
    const client = clientMap.get(order.clientId);
    return {
      text: `Замовлення № ${order.number ?? "—"}${client ? ` · ${client.name}` : ""}`,
      href: `/orders/${order.id}`,
    };
  };
  const clientTitle = (clientId: string | null, suffix = ""): Subject => {
    if (!clientId) return { text: "Клієнт", href: null };
    const client = clientMap.get(clientId);
    if (!client) return { text: `Клієнт (видалено)${suffix}`, href: null };
    return {
      text: `Клієнт ${client.code} · ${client.name}${suffix}`,
      href: `/clients/${client.id}`,
    };
  };

  const subjects = new Map<string, Subject>();
  for (const row of rows) {
    const diff = row.diff as AuditDiff;
    switch (row.tableName) {
      case "orders":
        subjects.set(row.id, orderTitle(row.rowId));
        break;
      case "order_items": {
        const title = items.get(row.rowId)?.title ?? valueOf(diff, "title");
        const base = orderTitle(orderOf(row));
        subjects.set(row.id, {
          ...base,
          text: `${base.text} · позиція${title ? ` «${title}»` : ""}`,
        });
        break;
      }
      case "order_price_changes":
        subjects.set(row.id, orderTitle(orderOf(row)));
        break;
      case "cash_entries": {
        const base = orderTitle(orderOf(row));
        const order = orderOf(row);
        const orderRow = order ? orderMap.get(order) : undefined;
        subjects.set(row.id, {
          text: base.text,
          href: orderRow ? `/more/cash?date=${orderRow.orderDate}#order-${orderRow.id}` : null,
        });
        break;
      }
      case "clients":
        subjects.set(row.id, clientTitle(row.rowId));
        break;
      case "client_contacts": {
        const name = contacts.get(row.rowId)?.name ?? valueOf(diff, "name");
        subjects.set(
          row.id,
          clientTitle(clientOf(row), name ? ` · контакт «${name}»` : " · контакт"),
        );
        break;
      }
      case "client_addresses":
        subjects.set(row.id, clientTitle(clientOf(row), " · адреса"));
        break;
      case "client_prices":
        subjects.set(row.id, clientTitle(clientOf(row), " · ціна"));
        break;
      case "default_prices": {
        const iceId = valueOf(diff, "ice_type_id");
        subjects.set(row.id, {
          text: `Прайс${iceId && iceMap.get(iceId) ? ` · ${iceMap.get(iceId)}` : ""}`,
          href: "/more/prices",
        });
        break;
      }
      case "profiles": {
        const profile = profileMap.get(row.rowId);
        subjects.set(row.id, {
          text: `Користувач ${profile?.fullName ?? valueOf(diff, "full_name") ?? ""}`.trim(),
          href: profile ? `/more/users/${profile.id}` : null,
        });
        break;
      }
      case "settings":
        subjects.set(row.id, { text: `Налаштування ${row.rowId}`, href: null });
        break;
      default:
        subjects.set(row.id, { text: row.tableName, href: null });
    }
  }
  return subjects;
}

/** Рядки журналу перетворює на подання: хто, що, коли, «було → стало». */
async function toViews(db: AnyPgDatabase, rows: AuditRow[]): Promise<AuditEntryView[]> {
  if (rows.length === 0) return [];
  const wanted = new Map<AuditRef, Set<string>>();
  const want = (kind: AuditRef, id: string) => {
    if (!wanted.has(kind)) wanted.set(kind, new Set());
    wanted.get(kind)!.add(id);
  };
  for (const row of rows) {
    for (const [kind, id] of collectRefs(row.tableName, row.diff as AuditDiff)) want(kind, id);
    if (row.actorId) want("user", row.actorId);
  }
  const [names, subjects] = await Promise.all([loadNames(db, wanted), loadSubjects(db, rows)]);

  return rows.map((row) => {
    const table = AUDIT_TABLES[row.tableName];
    const diff = row.diff as AuditDiff;
    const changes = buildChanges(row.tableName, row.action, diff, names);
    const described = describeAuditEntry(row.tableName, row.action, diff, changes);
    const subject = subjects.get(row.id) ?? { text: table?.label ?? row.tableName, href: null };
    return {
      id: row.id,
      at: row.at.toISOString(),
      actorName: row.actorId ? (names.user.get(row.actorId) ?? "Користувач") : SYSTEM_NAME,
      action: row.action,
      sectionLabel: table ? AUDIT_SECTIONS[table.section] : "",
      tableLabel: table?.label ?? row.tableName,
      subject: subject.text,
      href: subject.href,
      summary: described.summary,
      changes: described.changes,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Публічні функції
// ---------------------------------------------------------------------------------------------

const filtersSchema = z.object({
  section: z.enum(Object.keys(AUDIT_SECTIONS) as [AuditSection, ...AuditSection[]]).optional(),
  actorId: uuid.optional(),
  dateFrom: z.string().refine(isIsoDate, "Некоректна дата «від».").optional(),
  dateTo: z.string().refine(isIsoDate, "Некоректна дата «до».").optional(),
  search: z.string().trim().max(60, "Пошук надто довгий.").optional(),
});

/** За що шукає рядок пошуку: номер замовлення (цифри) чи код клієнта. `null`, якщо нічого не знайдено. */
async function resolveSearch(db: AnyPgDatabase, search: string): Promise<Entity | null> {
  if (/^\d+$/.test(search)) {
    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.number, Number(search)))
      .limit(1);
    if (order) return { kind: "order", id: order.id };
  }
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.code, normalizeClientCode(search)))
    .limit(1);
  return client ? { kind: "client", id: client.id } : null;
}

/**
 * Журнал змін для екрана: фільтри за розділом, користувачем, днями (за київським часом) і
 * номером замовлення чи кодом клієнта. Нові записи першими. Лише власник і бухгалтер.
 */
export async function listAuditEntries(
  db: AnyPgDatabase,
  actor: AppUser,
  input: AuditFilters,
  page: { offset?: number; limit?: number } = {},
): Promise<AuditPage> {
  requirePermission(actor, "audit_log", "read");
  const filters = parseInput(filtersSchema, input);
  const limit = Math.min(Math.max(page.limit ?? AUDIT_PAGE_SIZE, 1), 100);
  const offset = Math.max(page.offset ?? 0, 0);

  const conditions: (SQL | undefined)[] = [];
  if (filters.section)
    conditions.push(inArray(auditLog.tableName, tablesOfSection(filters.section)));
  if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
  // «Від» і «до» це дні за Києвом: початок першого дня і початок дня після останнього.
  if (filters.dateFrom) {
    conditions.push(
      gte(auditLog.at, sql`((${filters.dateFrom}::date)::timestamp at time zone 'Europe/Kyiv')`),
    );
  }
  if (filters.dateTo) {
    conditions.push(
      lt(auditLog.at, sql`(((${filters.dateTo}::date + 1))::timestamp at time zone 'Europe/Kyiv')`),
    );
  }
  if (filters.search) {
    const entity = await resolveSearch(db, filters.search);
    if (!entity) return { items: [], hasMore: false };
    conditions.push(await entityCondition(db, entity));
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1)
    .offset(offset);
  return { items: await toViews(db, rows.slice(0, limit)), hasMore: rows.length > limit };
}

/** Користувачі, що хоч раз щось змінили: для вибору в фільтрі журналу. */
export async function listAuditActors(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<{ id: string; name: string }[]> {
  requirePermission(actor, "audit_log", "read");
  const rows = await db
    .selectDistinct({ id: profiles.id, name: profiles.fullName })
    .from(auditLog)
    .innerJoin(profiles, eq(profiles.id, auditLog.actorId))
    .orderBy(profiles.fullName);
  return rows;
}

/**
 * Історія змін одного замовлення чи клієнта для картки (ТЗ §11): усе, що стосується замовлення
 * (включно з позиціями, змінами ціни й готівкою) чи клієнта (контакти, адреси, ціни). Лише ролі,
 * що бачать гроші: власник, менеджер, бухгалтер.
 */
export async function listEntityHistory(
  db: AnyPgDatabase,
  actor: AppUser,
  target: Entity,
  options: { limit?: number } = {},
): Promise<AuditPage> {
  const id = parseInput(uuid, target.id);
  if (target.kind === "order") {
    requirePermission(actor, "order_money", "read");
    await loadOrderRow(db, id);
  } else {
    requirePermission(actor, "client_prices", "read");
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    if (!client) throw new ValidationError("Клієнта не знайдено.");
  }
  const limit = Math.min(Math.max(options.limit ?? HISTORY_LIMIT, 1), 200);
  const rows = await db
    .select()
    .from(auditLog)
    .where(await entityCondition(db, { kind: target.kind, id }))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  return { items: await toViews(db, rows.slice(0, limit)), hasMore: rows.length > limit };
}
