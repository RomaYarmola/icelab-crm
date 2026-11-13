import { asc } from "drizzle-orm";
import { withActor } from "@/db/actor";
import {
  boxTypes,
  cashEntries,
  clientAddresses,
  clientApplications,
  clientContacts,
  clientPrices,
  clients,
  clientStatuses,
  dataExports,
  defaultPrices,
  iceTypes,
  locations,
  orderItems,
  orderPriceChanges,
  orders,
  orderSources,
  orderStatusHistory,
  profiles,
  regions,
  settings,
} from "@/db/schema";
import { ADDRESS_KIND_LABELS, LEGAL_TYPE_LABELS } from "@/constants/clients";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/constants/constants";
import {
  BOX_OWNERSHIP_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_KIND_LABELS,
} from "@/constants/orders";
import type { AnyPgDatabase } from "@/db/types";
import { formatIsoDate, todayIso } from "@/utils/isoDate";
import { ENTERED_VIA_LABELS, ITEM_KIND_LABELS } from "./audit-labels";
import { listCashDay, type CashDay } from "./cash";
import { listClients, type ClientListQuery } from "./clients";
import { ValidationError } from "./errors";
import { buildWorkbook, sheetOf, type ExportColumn, type ExportSheet } from "./export-xlsx";
import { can } from "./permissions";
import { type AppUser, requirePermission } from "./guards";
import { listOrders, type OrderListQuery } from "./orders";

/**
 * Експорт у Excel (B8, D92–D96). Списки «Замовлення», «Клієнти» і «Готівка» беруть дані тими самими
 * функціями читання, що й екрани, тож права, область локації й заборонені поля діють так само.
 * «Експорт усього» дає власнику одну книгу з аркушем на кожну робочу таблицю (без акаунтів, паролів
 * і секретів). Кожен експорт пишемо в журнал експортів (`exports`), самі файли не зберігаємо.
 */

export type ExportKind = (typeof dataExports.$inferInsert)["kind"];

export type ExportFile = {
  kind: ExportKind;
  fileName: string;
  buffer: Buffer;
  /** Скільки рядків даних у файлі (без заголовків, за всіма аркушами). */
  rowCount: number;
};

/** Найбільше рядків у списку (за ТЗ близько 5 000 замовлень на рік, з запасом). */
export const EXPORT_MAX_ROWS = 20_000;
/** «Експорт усього»: ліміт на один аркуш (повний аркуш Excel вміщує понад мільйон рядків). */
export const EXPORT_ALL_MAX_ROWS = 100_000;

const TOO_MANY = (limit: number) =>
  `У файлі було б понад ${limit.toLocaleString("uk-UA")} рядків. Звузьте фільтр (дати, статус, пошук) і повторіть.`;

const FILE_PREFIX = "icelab";

function fileNameFor(slug: string): string {
  return `${FILE_PREFIX}-${slug}-${todayIso()}.xlsx`;
}

// ---------------------------------------------------------------------------------------------
// Короткі конструктори колонок
// ---------------------------------------------------------------------------------------------

type Value = ReturnType<ExportColumn<unknown>["value"]>;
const col =
  (kind: ExportColumn<unknown>["kind"]) =>
  <R>(header: string, value: (row: R) => Value): ExportColumn<R> => ({ header, kind, value });
const text = col("text");
const phone = col("phone");
const num = col("number");
const money = col("money");
const day = col("date");
const flag = col("bool");

/** Конструктори колонок для рядків одного типу: тип рядка виводиться з `rows`, а не пишеться вручну. */
function columnsFor<R>() {
  const make =
    (kind: ExportColumn<R>["kind"]) =>
    (header: string, value: (row: R) => Value): ExportColumn<R> => ({ header, kind, value });
  return {
    text: make("text"),
    phone: make("phone"),
    num: make("number"),
    money: make("money"),
    day: make("date"),
    moment: make("datetime"),
    flag: make("bool"),
  };
}

function sheet<R>(
  name: string,
  rows: R[],
  build: (c: ReturnType<typeof columnsFor<R>>) => ExportColumn<R>[],
): ExportSheet<unknown> {
  return sheetOf({ name, rows, columns: build(columnsFor<R>()) });
}

/** Підпис значення переліку; невідоме значення лишаємо як є, щоб нічого не губити. */
const label = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? value) : null;

// ---------------------------------------------------------------------------------------------
// Запис у журнал експортів
// ---------------------------------------------------------------------------------------------

/** Фільтри для журналу експортів: ключі й значення зрозумілі людині (так і показуємо у журналі змін). */
export type ExportParams = Record<string, string | number | boolean>;

async function recordExport(
  db: AnyPgDatabase,
  actor: AppUser,
  entry: { kind: ExportKind; params: ExportParams; rowCount: number; fileName: string },
): Promise<void> {
  await withActor(db, actor.id, async (tx) => {
    await tx.insert(dataExports).values({
      kind: entry.kind,
      params: entry.params,
      rowCount: entry.rowCount,
      fileName: entry.fileName,
      createdBy: actor.id,
    });
  });
}

/** Файл готовий, лише тоді його видаємо: спершу запис у журнал, щоб кожне вивантаження було видно. */
async function finish(
  db: AnyPgDatabase,
  actor: AppUser,
  entry: {
    kind: ExportKind;
    params: ExportParams;
    fileName: string;
    sheets: ExportSheet<unknown>[];
  },
): Promise<ExportFile> {
  const rowCount = entry.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  const buffer = await buildWorkbook(entry.sheets);
  await recordExport(db, actor, { ...entry, rowCount });
  return { kind: entry.kind, fileName: entry.fileName, buffer, rowCount };
}

async function nameOf(
  db: AnyPgDatabase,
  table: typeof profiles | typeof locations | typeof clientStatuses | typeof clientApplications,
  id: string,
  column: "fullName" | "name",
): Promise<string> {
  const rows = (await db.select().from(table)) as Record<string, unknown>[];
  const found = rows.find((row) => row.id === id);
  return found ? String(found[column]) : "—";
}

// ---------------------------------------------------------------------------------------------
// Замовлення
// ---------------------------------------------------------------------------------------------

async function describeOrderFilters(
  db: AnyPgDatabase,
  query: OrderListQuery,
): Promise<ExportParams> {
  const params: ExportParams = {};
  if (query.dateFrom) params["Дата виконання від"] = formatIsoDate(query.dateFrom);
  if (query.dateTo) params["Дата виконання до"] = formatIsoDate(query.dateTo);
  if (query.statuses?.length) {
    params["Статус"] = query.statuses.map((s) => ORDER_STATUS_LABELS[s] ?? s).join(", ");
  }
  if (query.managerId) params["Менеджер"] = await nameOf(db, profiles, query.managerId, "fullName");
  if (query.deliveryMethod) {
    params["Доставка"] =
      label(DELIVERY_METHOD_LABELS, query.deliveryMethod) ?? query.deliveryMethod;
  }
  if (query.locationId) params["Локація"] = await nameOf(db, locations, query.locationId, "name");
  if (query.search?.trim()) params["Пошук"] = query.search.trim();
  return params;
}

/** Список замовлень з поточними фільтрами екрана. Сума лише для ролей, що бачать гроші. */
export async function exportOrders(
  db: AnyPgDatabase,
  actor: AppUser,
  query: OrderListQuery = {},
  options: { maxRows?: number } = {},
): Promise<ExportFile> {
  requirePermission(actor, "excel_export", "write");
  const maxRows = options.maxRows ?? EXPORT_MAX_ROWS;
  const page = await listOrders(
    db,
    actor,
    { ...query, offset: 0, limit: maxRows },
    { maxLimit: maxRows },
  );
  if (page.hasMore) throw new ValidationError(TOO_MANY(maxRows));

  type Row = (typeof page.items)[number];
  const columns: ExportColumn<Row>[] = [
    num("№", (r) => r.number),
    day("Дата виконання", (r) => r.orderDate),
    text("Код клієнта", (r) => r.clientCode),
    text("Клієнт", (r) => r.clientName),
    text("Локація", (r) => r.locationName),
    text("Статус", (r) => label(ORDER_STATUS_LABELS, r.status)),
    text("Лід", (r) => r.iceTypeName),
    num("Кг на продаж", (r) => r.kgSold),
    num("Кг виготовити", (r) => r.kgToProduce),
    text("Доставка", (r) => label(DELIVERY_METHOD_LABELS, r.deliveryMethod)),
  ];
  if (can(actor.role, "order_money", "read")) {
    columns.push(money("Сума, ₴", (r) => r.total ?? null));
  }
  return finish(db, actor, {
    kind: "orders",
    params: await describeOrderFilters(db, query),
    fileName: fileNameFor("orders"),
    sheets: [sheetOf({ name: "Замовлення", columns, rows: page.items })],
  });
}

// ---------------------------------------------------------------------------------------------
// Клієнти
// ---------------------------------------------------------------------------------------------

async function describeClientFilters(
  db: AnyPgDatabase,
  query: ClientListQuery,
): Promise<ExportParams> {
  const params: ExportParams = {};
  if (query.search?.trim()) params["Пошук"] = query.search.trim();
  if (query.statusId) params["Статус"] = await nameOf(db, clientStatuses, query.statusId, "name");
  if (query.managerId) params["Менеджер"] = await nameOf(db, profiles, query.managerId, "fullName");
  if (query.applicationId) {
    params["Застосування"] = await nameOf(db, clientApplications, query.applicationId, "name");
  }
  if (query.includeDeleted) params["З видаленими"] = true;
  return params;
}

/** Список клієнтів без цін і службових полів, з тими самими фільтрами, що й на екрані. */
export async function exportClients(
  db: AnyPgDatabase,
  actor: AppUser,
  query: ClientListQuery = {},
  options: { maxRows?: number } = {},
): Promise<ExportFile> {
  requirePermission(actor, "excel_export", "write");
  const maxRows = options.maxRows ?? EXPORT_MAX_ROWS;
  const page = await listClients(
    db,
    actor,
    { ...query, offset: 0, limit: maxRows },
    { maxLimit: maxRows },
  );
  if (page.hasMore) throw new ValidationError(TOO_MANY(maxRows));

  type Row = (typeof page.items)[number];
  const columns: ExportColumn<Row>[] = [
    text("Код", (r) => r.code),
    text("Назва", (r) => r.name),
    text("Статус", (r) => r.statusName),
    text("Менеджер", (r) => r.managerName),
    phone("Телефон", (r) => r.primaryPhone),
  ];
  // Видалених бачить лише власник (їх вмикає він), тож колонка з'являється тільки тоді.
  if (query.includeDeleted && actor.role === "owner") {
    columns.push(flag("Видалено", (r) => r.isDeleted));
  }
  return finish(db, actor, {
    kind: "clients",
    params: await describeClientFilters(db, query),
    fileName: fileNameFor("clients"),
    sheets: [sheetOf({ name: "Клієнти", columns, rows: page.items })],
  });
}

// ---------------------------------------------------------------------------------------------
// Готівка
// ---------------------------------------------------------------------------------------------

function cashSheets(cashDay: CashDay): ExportSheet<unknown>[] {
  type OrderRow = CashDay["orders"][number];
  type EntryRow = { order: OrderRow; entry: OrderRow["entries"][number] };

  const orderColumns: ExportColumn<OrderRow>[] = [
    num("№", (r) => r.number),
    day("Дата", (r) => r.orderDate),
    text("Код клієнта", (r) => r.clientCode),
    text("Клієнт", (r) => r.clientName),
    text("Локація", (r) => r.locationName),
    text("Статус", (r) => label(ORDER_STATUS_LABELS, r.status)),
    money("Сума до сплати, ₴", (r) => r.amountDue),
    money("Прийнято, ₴", (r) => r.receivedSum),
    money("Залишок, ₴", (r) => r.remainingSum),
    flag("Сплачено", (r) => r.isPaid),
  ];
  const entryColumns: ExportColumn<EntryRow>[] = [
    num("№ замовлення", (r) => r.order.number),
    text("Клієнт", (r) => r.order.clientName),
    day("Дата прийому", (r) => r.entry.receivedOn),
    money("Сума, ₴", (r) => r.entry.sumReceived),
    text("Хто прийняв", (r) => r.entry.receivedBy),
    text("Звідки внесено", (r) => label(ENTERED_VIA_LABELS, r.entry.enteredVia)),
    text("Примітка", (r) => r.entry.note),
    flag("Сторновано", (r) => r.entry.isReversed),
    text("Причина сторно", (r) => r.entry.reversalReason),
  ];
  const summary = cashDay.summary;
  const summaryRows: { name: string; sum: string }[] = [
    { name: "Мало надійти", sum: summary.expectedSum },
    { name: "Внесено", sum: summary.enteredSum },
    { name: "Різниця", sum: summary.differenceSum },
    { name: "Прийнято цього дня (за датою прийому)", sum: summary.receivedOnDaySum },
    ...summary.byReceiver.map((r) => ({ name: `Прийняв: ${r.name}`, sum: r.sumReceived })),
  ];
  return [
    sheetOf({ name: "Готівка", columns: orderColumns, rows: cashDay.orders }),
    sheetOf({
      name: "Записи",
      columns: entryColumns,
      rows: cashDay.orders.flatMap((order) => order.entries.map((entry) => ({ order, entry }))),
    }),
    sheetOf({
      name: "Підсумок",
      columns: [
        text<(typeof summaryRows)[number]>("Показник", (r) => r.name),
        money<(typeof summaryRows)[number]>("Сума, ₴", (r) => r.sum),
      ],
      rows: summaryRows,
    }),
  ];
}

/** Готівка за день і локацією, як на екрані «Готівка»: замовлення, записи й підсумок. */
export async function exportCash(
  db: AnyPgDatabase,
  actor: AppUser,
  scope: { date: string; locationId?: string | null },
): Promise<ExportFile> {
  requirePermission(actor, "excel_export", "write");
  const cashDay = await listCashDay(db, actor, scope);
  const params: ExportParams = { Дата: formatIsoDate(cashDay.date) };
  params["Локація"] = cashDay.locationId
    ? await nameOf(db, locations, cashDay.locationId, "name")
    : "усі";
  return finish(db, actor, {
    kind: "cash",
    params,
    fileName: `${FILE_PREFIX}-cash-${cashDay.date}.xlsx`,
    sheets: cashSheets(cashDay),
  });
}

// ---------------------------------------------------------------------------------------------
// Експорт усього
// ---------------------------------------------------------------------------------------------

type Lookups = Record<
  | "client"
  | "location"
  | "iceType"
  | "source"
  | "boxType"
  | "address"
  | "user"
  | "application"
  | "status"
  | "order",
  Map<string, string>
>;

/** Налаштування, що схожі на секрети, не вивантажуємо ніколи. */
const SECRET_SETTING = /secret|token|password|passwd|api[_.-]?key|private/i;

async function loadAll<T>(rows: Promise<T[]>, sheetName: string): Promise<T[]> {
  const result = await rows;
  if (result.length > EXPORT_ALL_MAX_ROWS) {
    throw new ValidationError(`Аркуш «${sheetName}» завеликий для одного файлу.`);
  }
  return result;
}

/**
 * Уся база одним файлом XLSX: аркуш на кожну робочу таблицю. Без акаунтів, паролів, токенів і
 * налаштувань-секретів. Це зручна ручна копія даних, а не заміна резервних копій бази (B7a).
 * Лише власник.
 */
export async function exportEverything(db: AnyPgDatabase, actor: AppUser): Promise<ExportFile> {
  requirePermission(actor, "export_all", "write");

  const [
    clientRows,
    contactRows,
    addressRows,
    clientPriceRows,
    defaultPriceRows,
    orderRows,
    itemRows,
    historyRows,
    priceChangeRows,
    cashRows,
    locationRows,
    iceRows,
    boxRows,
    sourceRows,
    statusRows,
    applicationRows,
    regionRows,
    settingRows,
    profileRows,
  ] = await Promise.all([
    loadAll(db.select().from(clients).orderBy(asc(clients.code)), "Клієнти"),
    loadAll(db.select().from(clientContacts).orderBy(asc(clientContacts.createdAt)), "Контакти"),
    loadAll(db.select().from(clientAddresses).orderBy(asc(clientAddresses.createdAt)), "Адреси"),
    loadAll(db.select().from(clientPrices).orderBy(asc(clientPrices.validFrom)), "Ціни клієнтів"),
    loadAll(db.select().from(defaultPrices).orderBy(asc(defaultPrices.validFrom)), "Прайс"),
    loadAll(db.select().from(orders).orderBy(asc(orders.number)), "Замовлення"),
    loadAll(db.select().from(orderItems).orderBy(asc(orderItems.createdAt)), "Позиції замовлень"),
    loadAll(
      db.select().from(orderStatusHistory).orderBy(asc(orderStatusHistory.changedAt)),
      "Історія статусів",
    ),
    loadAll(
      db.select().from(orderPriceChanges).orderBy(asc(orderPriceChanges.changedAt)),
      "Зміни ціни",
    ),
    loadAll(db.select().from(cashEntries).orderBy(asc(cashEntries.createdAt)), "Готівка"),
    loadAll(db.select().from(locations).orderBy(asc(locations.name)), "Локації"),
    loadAll(db.select().from(iceTypes).orderBy(asc(iceTypes.sort)), "Типи льоду"),
    loadAll(db.select().from(boxTypes).orderBy(asc(boxTypes.sort)), "Типи боксів"),
    loadAll(db.select().from(orderSources).orderBy(asc(orderSources.name)), "Джерела замовлень"),
    loadAll(db.select().from(clientStatuses).orderBy(asc(clientStatuses.name)), "Статуси клієнтів"),
    loadAll(
      db.select().from(clientApplications).orderBy(asc(clientApplications.name)),
      "Застосування",
    ),
    loadAll(db.select().from(regions).orderBy(asc(regions.sort)), "Області"),
    loadAll(db.select().from(settings).orderBy(asc(settings.key)), "Налаштування"),
    // Лише імена: щоб підставити їх замість ідентифікаторів, самі акаунти в файл не потрапляють.
    loadAll(db.select({ id: profiles.id, name: profiles.fullName }).from(profiles), "Користувачі"),
  ]);

  const by = <T extends { id: string }>(rows: T[], name: (row: T) => string) =>
    new Map(rows.map((row) => [row.id, name(row)]));
  const lookups: Lookups = {
    client: by(clientRows, (c) => `${c.code} ${c.name}`),
    location: by(locationRows, (l) => l.name),
    iceType: by(iceRows, (i) => i.name),
    source: by(sourceRows, (s) => s.name),
    boxType: by(boxRows, (b) => b.name),
    address: by(addressRows, (a) => a.addressText ?? a.label ?? a.cityText ?? ""),
    user: by(profileRows, (p) => p.name),
    application: by(applicationRows, (a) => a.name),
    status: by(statusRows, (s) => s.name),
    order: by(orderRows, (o) => (o.number === null ? "чернетка" : `№ ${o.number}`)),
  };
  const name = (kind: keyof Lookups, id: string | null | undefined) =>
    id ? (lookups[kind].get(id) ?? "—") : null;

  const sheets: ExportSheet<unknown>[] = [
    sheet("Клієнти", clientRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
      c.text("Тип", (r) => label(LEGAL_TYPE_LABELS, r.legalType)),
      c.text("ЄДРПОУ", (r) => r.edrpou),
      c.text("Тип льоду", (r) => name("iceType", r.iceTypeId)),
      c.text("Застосування", (r) => name("application", r.applicationId)),
      c.text("Статус", (r) => name("status", r.statusId)),
      c.text("Менеджер", (r) => name("user", r.managerId)),
      c.text("Джерело", (r) => name("source", r.sourceId)),
      c.text("Тара за замовчуванням", (r) => name("boxType", r.defaultBoxTypeId)),
      c.num("Надбавка, %", (r) => r.markupPercentOverride),
      c.text("Примітки", (r) => r.notes),
      c.num("Неактивний, днів", (r) => r.inactiveDaysThreshold),
      c.flag("Заглушка", (r) => r.isPlaceholder),
      c.moment("Видалено", (r) => r.deletedAt),
      c.text("Об'єднано з", (r) => name("client", r.mergedIntoId)),
      c.moment("Створено", (r) => r.createdAt),
    ]),
    sheet("Контакти", contactRows, (c) => [
      c.text("Клієнт", (r) => name("client", r.clientId)),
      c.text("Ім'я", (r) => r.name),
      c.phone("Телефон", (r) => r.phone),
      c.text("Роль", (r) => r.role),
      c.flag("Основний", (r) => r.isPrimary),
    ]),
    sheet("Адреси", addressRows, (c) => [
      c.text("Клієнт", (r) => name("client", r.clientId)),
      c.text("Вид", (r) => label(ADDRESS_KIND_LABELS, r.kind)),
      c.text("Назва", (r) => r.label),
      c.text("Місто", (r) => r.cityText),
      c.text("Адреса", (r) => r.addressText),
      c.text("Одержувач", (r) => r.recipientName),
      c.text("Відділення НП", (r) => r.npWarehouseNumber),
      c.text("Вікно часу", (r) => r.timeWindow),
      c.flag("За замовчуванням", (r) => r.isDefault),
      c.flag("Розпізнано", (r) => r.isResolved),
    ]),
    sheet("Ціни клієнтів", clientPriceRows, (c) => [
      c.text("Клієнт", (r) => name("client", r.clientId)),
      c.text("Тип льоду", (r) => name("iceType", r.iceTypeId)),
      c.money("Ціна за кг, ₴", (r) => r.pricePerKg),
      c.num("Від, кг", (r) => r.minKg),
      c.day("Діє з", (r) => r.validFrom),
      c.day("Діє до", (r) => r.validTo),
    ]),
    sheet("Прайс", defaultPriceRows, (c) => [
      c.text("Тип льоду", (r) => name("iceType", r.iceTypeId)),
      c.num("Від, кг", (r) => r.minKg),
      c.money("Ціна за кг, ₴", (r) => r.pricePerKg),
      c.day("Діє з", (r) => r.validFrom),
      c.day("Діє до", (r) => r.validTo),
    ]),
    sheet("Замовлення", orderRows, (c) => [
      c.num("№", (r) => r.number),
      c.day("Дата виконання", (r) => r.orderDate),
      c.text("Клієнт", (r) => name("client", r.clientId)),
      c.text("Локація", (r) => name("location", r.locationId)),
      c.text("Статус", (r) => label(ORDER_STATUS_LABELS, r.status)),
      c.text("Джерело", (r) => name("source", r.sourceId)),
      c.text("Лід", (r) => name("iceType", r.iceTypeId)),
      c.num("Кг на продаж", (r) => r.kgSold),
      c.num("Кг виготовити", (r) => r.kgToProduce),
      c.num("Надбавка, %", (r) => r.markupPercentApplied),
      c.money("Ціна за кг, ₴", (r) => r.pricePerKgSnapshot),
      c.flag("Ціна вручну", (r) => r.priceManual),
      c.text("Доставка", (r) => label(DELIVERY_METHOD_LABELS, r.deliveryMethod)),
      c.text("Адреса клієнта", (r) => name("address", r.addressId)),
      c.text("Адреса текстом", (r) => r.deliveryText),
      c.text("Вікно часу", (r) => r.timeWindow),
      c.text("Одержувач", (r) => r.recipientName),
      c.phone("Телефон одержувача", (r) => r.recipientPhone),
      c.text("Тип боксу", (r) => name("boxType", r.boxTypeId)),
      c.num("Боксів", (r) => r.boxCount),
      c.text("Чий бокс", (r) => label(BOX_OWNERSHIP_LABELS, r.boxOwnership)),
      c.text("Коментар", (r) => r.comment),
      c.text("Внутрішній коментар", (r) => r.internalComment),
      c.text("Оплата", (r) => label(PAYMENT_KIND_LABELS, r.paymentKind)),
      c.money("Сума, ₴", (r) => r.total),
      c.moment("Підтверджено", (r) => r.confirmedAt),
      c.moment("Виготовлено", (r) => r.producedAt),
      c.moment("Запаковано", (r) => r.packedAt),
      c.moment("Відправлено", (r) => r.shippedAt),
      c.moment("Оплачено", (r) => r.paidAt),
      c.moment("Закрито", (r) => r.closedAt),
      c.text("Причина скасування", (r) => r.cancelReason),
      c.flag("Архівне", (r) => r.isArchive),
      c.moment("Видалено", (r) => r.deletedAt),
      c.moment("Створено", (r) => r.createdAt),
    ]),
    sheet("Позиції замовлень", itemRows, (c) => [
      c.text("Замовлення", (r) => name("order", r.orderId)),
      c.text("Вид", (r) => label(ITEM_KIND_LABELS, r.kind)),
      c.text("Назва", (r) => r.title),
      c.num("Кількість", (r) => r.qty),
      c.text("Одиниця", (r) => r.unit),
      c.money("Ціна, ₴", (r) => r.price),
      c.money("Сума, ₴", (r) => r.amount),
      c.text("Тип боксу", (r) => name("boxType", r.boxTypeId)),
    ]),
    sheet("Історія статусів", historyRows, (c) => [
      c.text("Замовлення", (r) => name("order", r.orderId)),
      c.text("Було", (r) => label(ORDER_STATUS_LABELS, r.fromStatus as OrderStatus | null)),
      c.text("Стало", (r) => label(ORDER_STATUS_LABELS, r.toStatus)),
      c.text("Хто змінив", (r) => name("user", r.changedBy)),
      c.moment("Коли", (r) => r.changedAt),
      c.text("Примітка", (r) => r.note),
    ]),
    sheet("Зміни ціни", priceChangeRows, (c) => [
      c.text("Замовлення", (r) => name("order", r.orderId)),
      c.money("Було, ₴", (r) => r.oldPrice),
      c.money("Стало, ₴", (r) => r.newPrice),
      c.text("Причина", (r) => r.note),
      c.text("Хто змінив", (r) => name("user", r.changedBy)),
      c.moment("Коли", (r) => r.changedAt),
    ]),
    sheet("Готівка", cashRows, (c) => [
      c.text("Замовлення", (r) => name("order", r.orderId)),
      c.text("Локація", (r) => name("location", r.locationId)),
      c.money("Сума, ₴", (r) => r.amount),
      c.day("Дата прийому", (r) => r.receivedOn),
      c.text("Хто прийняв", (r) => r.receivedByText),
      c.text("Хто вніс", (r) => name("user", r.enteredBy)),
      c.text("Звідки внесено", (r) => label(ENTERED_VIA_LABELS, r.enteredVia)),
      c.text("Примітка", (r) => r.note),
      c.moment("Сторновано", (r) => r.reversedAt),
      c.text("Хто сторнував", (r) => name("user", r.reversedBy)),
      c.text("Причина сторно", (r) => r.reversalReason),
      c.moment("Створено", (r) => r.createdAt),
    ]),
    sheet("Локації", locationRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
      c.text("Адреса", (r) => r.addressText),
      c.phone("Телефон відправника НП", (r) => r.npSenderPhone),
      c.flag("Активна", (r) => r.isActive),
    ]),
    sheet("Типи льоду", iceRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
      c.flag("Активний", (r) => r.isActive),
      c.num("Порядок", (r) => r.sort),
    ]),
    sheet("Типи боксів", boxRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
      c.num("Об'єм, л", (r) => r.volumeL),
      c.num("Місткість, кг", (r) => r.capacityKg),
      c.flag("Оборотний", (r) => r.isReturnable),
      c.flag("Клієнтський", (r) => r.isClientOwned),
      c.money("Ціна продажу, ₴", (r) => r.salePrice),
      c.flag("Активний", (r) => r.isActive),
    ]),
    sheet("Джерела замовлень", sourceRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
      c.flag("Активне", (r) => r.isActive),
    ]),
    sheet("Статуси клієнтів", statusRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
    ]),
    sheet("Застосування", applicationRows, (c) => [
      c.text("Код", (r) => r.code),
      c.text("Назва", (r) => r.name),
    ]),
    sheet("Області", regionRows, (c) => [
      c.text("Префікс", (r) => r.prefix),
      c.text("Назва", (r) => r.name),
      c.num("Порядок", (r) => r.sort),
    ]),
    sheet(
      "Налаштування",
      settingRows.filter((row) => !SECRET_SETTING.test(row.key)),
      (c) => [
        c.text("Параметр", (r) => r.key),
        c.text("Значення", (r) =>
          typeof r.value === "string" ? r.value : JSON.stringify(r.value),
        ),
      ],
    ),
  ];

  return finish(db, actor, {
    kind: "all",
    params: {},
    fileName: fileNameFor("all-data"),
    sheets,
  });
}
