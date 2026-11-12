import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import {
  boxTypes,
  clientAddresses,
  clientApplications,
  clients,
  iceTypes,
  locations,
  orderItems,
  orderPriceChanges,
  orders,
  orderSources,
  orderStatusHistory,
  profiles,
  settings,
} from "@/db/schema";
import { boxOwnership, deliveryMethod, orderStatus, paymentKind } from "@/db/schema/enums";
import type { AnyPgDatabase } from "@/db/types";
import type { OrderStatus } from "@/constants/constants";
import { isIsoDate } from "@/utils/isoDate";
import { computeKgToProduce, parseDecimal } from "@/utils/orderMath";
import { normalizePhone } from "@/utils/phone";
import { clientSearchCondition } from "./clients";
import { parseInput, ValidationError } from "./errors";
import { ForbiddenError, type AppUser, requirePermission, requireRole } from "./guards";
import {
  canDeleteDraft,
  DEFAULT_MARKUP_SETTINGS,
  editPolicy,
  type MarkupSettings,
  suggestMarkupPercent,
} from "./order-rules";
import {
  type OrderCardView,
  type OrderListItem,
  toOrderCardView,
  toOrderHistoryItem,
  toOrderListItem,
  toPriceChangeView,
} from "./order-views";
import { isOwnLocationOnly, can } from "./permissions";
import { parsePricePerKg } from "./price-rules";
import { resolvePrice } from "./prices";

/**
 * Замовлення (B5): список із фільтрами, картка, створення чернетки, зміна за правилами D58 і
 * видалення чернетки. Позиції: `order-items.ts`, переходи статусів і зміна ціни:
 * `order-status.ts`, дублі й «як минулого разу»: `order-duplicates.ts`. Чисті правила (хто що
 * може, надбавка) лежать у `order-rules.ts`, тут лише робота з базою.
 */

export const ORDERS_PAGE_SIZE = 30;
const SEARCH_MAX_LENGTH = 100;
const MAX_KG = 100_000;

const uuid = z.uuid("Некоректний ідентифікатор.");
const optionalUuid = uuid.nullable().optional();

type OrderRow = typeof orders.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Схеми введення
// ---------------------------------------------------------------------------------------------

const kgField = z
  .union([z.string(), z.number()])
  .transform((value) => parseDecimal(value))
  .pipe(
    z
      .number("Кілограми мають бути числом.")
      .min(0, "Кілограми не можуть бути від'ємними.")
      .max(MAX_KG, "Забагато кілограмів: перевірте число."),
  )
  .transform((value) => value.toFixed(3));

const textField = (max: number, message: string) =>
  z.string().trim().max(max, message).nullable().optional();

const dateField = z.string().refine(isIsoDate, "Вкажіть дату замовлення.");

/** Ціна за кг: число, текст («60,50») або `null` («порахувати за прайсом»). Перевіряє `parsePricePerKg`. */
const priceField = z.union([z.string(), z.number()]).nullable().optional();

const optionalFields = z
  .object({
    iceTypeId: optionalUuid,
    kgSold: kgField,
    kgToProduce: kgField,
    sourceId: optionalUuid,
    deliveryMethod: z.enum(deliveryMethod.enumValues, "Оберіть спосіб доставки зі списку."),
    addressId: optionalUuid,
    deliveryText: textField(500, "Текст доставки надто довгий."),
    timeWindow: textField(50, "Вікно часу надто довге."),
    recipientName: textField(100, "Ім'я отримувача надто довге."),
    recipientPhone: z.string().nullable().optional(),
    boxTypeId: optionalUuid,
    boxCount: z
      .number("Кількість тари має бути числом.")
      .int("Кількість тари має бути цілою.")
      .min(0, "Кількість тари не може бути від'ємною.")
      .max(10_000, "Забагато тари: перевірте число."),
    boxOwnership: z.enum(boxOwnership.enumValues, "Оберіть, чия тара."),
    paymentKind: z.enum(paymentKind.enumValues, "Оберіть спосіб оплати зі списку."),
    comment: textField(2000, "Коментар надто довгий."),
    internalComment: textField(2000, "Внутрішній коментар надто довгий."),
  })
  .partial();

const createOrderSchema = optionalFields.extend({
  clientId: uuid,
  locationId: uuid,
  orderDate: dateField,
  price: priceField,
});

const updateOrderSchema = optionalFields.extend({
  clientId: uuid.optional(),
  locationId: uuid.optional(),
  orderDate: dateField.optional(),
  price: priceField,
});

export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type UpdateOrderInput = z.input<typeof updateOrderSchema>;

/** Поля, які належать до «основних» (D58): клієнт, дата, лід, кг, доставка, адреса, тара, оплата. */
const CORE_KEYS = [
  "clientId",
  "locationId",
  "orderDate",
  "iceTypeId",
  "kgSold",
  "sourceId",
  "deliveryMethod",
  "addressId",
  "deliveryText",
  "timeWindow",
  "recipientName",
  "recipientPhone",
  "boxTypeId",
  "boxCount",
  "boxOwnership",
  "paymentKind",
] as const;

// ---------------------------------------------------------------------------------------------
// Допоміжне: довідники, клієнт, надбавка
// ---------------------------------------------------------------------------------------------

/** Замовлення за ідентифікатором. Видалена чернетка вважається неіснуючою. */
export async function loadOrderRow(db: AnyPgDatabase, orderId: string): Promise<OrderRow> {
  const id = parseInput(uuid, orderId);
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
    .limit(1);
  if (!row) throw new ValidationError("Замовлення не знайдено.");
  return row;
}

type ClientContext = { markupOverride: number | null; applicationCode: string | null };

async function loadClientContext(db: AnyPgDatabase, clientId: string): Promise<ClientContext> {
  const [row] = await db
    .select({
      deletedAt: clients.deletedAt,
      markup: clients.markupPercentOverride,
      applicationCode: clientApplications.code,
    })
    .from(clients)
    .leftJoin(clientApplications, eq(clientApplications.id, clients.applicationId))
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row) throw new ValidationError("Клієнта не знайдено.");
  if (row.deletedAt) throw new ValidationError("Клієнта видалено: нове замовлення не створити.");
  return {
    markupOverride: row.markup === null ? null : parseDecimal(row.markup),
    applicationCode: row.applicationCode,
  };
}

async function getMarkupSettings(db: AnyPgDatabase): Promise<MarkupSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, ["markup.np_percent", "markup.event_percent"]));
  const read = (key: string, fallback: number) => {
    const value = rows.find((row) => row.key === key)?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  return {
    npPercent: read("markup.np_percent", DEFAULT_MARKUP_SETTINGS.npPercent),
    eventPercent: read("markup.event_percent", DEFAULT_MARKUP_SETTINGS.eventPercent),
  };
}

async function assertActiveLocation(db: AnyPgDatabase, locationId: string) {
  const [row] = await db
    .select({ isActive: locations.isActive })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!row) throw new ValidationError("Локацію не знайдено.");
  if (!row.isActive) throw new ValidationError("Ця локація вимкнена.");
}

async function loadIceTypeName(db: AnyPgDatabase, iceTypeId: string): Promise<string> {
  const [row] = await db
    .select({ name: iceTypes.name, isActive: iceTypes.isActive })
    .from(iceTypes)
    .where(eq(iceTypes.id, iceTypeId))
    .limit(1);
  if (!row) throw new ValidationError("Тип льоду не знайдено.");
  if (!row.isActive) throw new ValidationError("Цей тип льоду вимкнено.");
  return row.name;
}

async function assertExists(
  db: AnyPgDatabase,
  table: typeof boxTypes | typeof orderSources,
  id: string | null | undefined,
  message: string,
) {
  if (!id) return;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new ValidationError(message);
}

async function assertAddressOfClient(
  db: AnyPgDatabase,
  addressId: string | null | undefined,
  clientId: string,
) {
  if (!addressId) return;
  const [row] = await db
    .select({ clientId: clientAddresses.clientId })
    .from(clientAddresses)
    .where(eq(clientAddresses.id, addressId))
    .limit(1);
  if (!row || row.clientId !== clientId) {
    throw new ValidationError("Адреса не належить цьому клієнту.");
  }
}

function parsePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined || input.trim() === "") return null;
  const phone = normalizePhone(input);
  if (!phone) {
    throw new ValidationError("Не вдалося розпізнати телефон. Вкажіть, наприклад, 050 123 45 67.");
  }
  return phone;
}

/** Ціна за прайсом (D52) і надбавка (D53) для замовлення; `price` `null`, якщо ціни немає ніде. */
async function autoValues(
  db: AnyPgDatabase,
  input: {
    clientId: string;
    iceTypeId: string | null;
    orderDate: string;
    deliveryMethod: string;
    kgSold: number;
  },
) {
  const [client, markupSettings] = await Promise.all([
    loadClientContext(db, input.clientId),
    getMarkupSettings(db),
  ]);
  const resolved = input.iceTypeId
    ? await resolvePrice(db, {
        clientId: input.clientId,
        iceTypeId: input.iceTypeId,
        date: input.orderDate,
      })
    : null;
  const percent = suggestMarkupPercent({
    deliveryMethod: input.deliveryMethod,
    applicationCode: client.applicationCode,
    clientOverridePercent: client.markupOverride,
    settings: markupSettings,
  });
  return {
    price: resolved?.pricePerKg ?? null,
    percent,
    kgToProduce: computeKgToProduce(input.kgSold, percent),
  };
}

function iceItemTitle(iceTypeName: string | null): string {
  return iceTypeName ? `Лід ${iceTypeName}` : "Лід";
}

// ---------------------------------------------------------------------------------------------
// Створення
// ---------------------------------------------------------------------------------------------

export type CreatedOrder = { id: string; number: number | null };

/**
 * Створює чернетку (D52–D55): ціна береться за правилом B4 на дату виконання (або її вказує
 * менеджер вручну), «виготовити» рахується з надбавкою, позиція «Лід» створюється разом із
 * замовленням. Створюють власник і менеджер (D58). Ту саму функцію викличе й приймання заявок (B11).
 */
export async function createOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  requirePermission(actor, "orders", "write", { anyLocation: true });
  requireRole(actor, "owner", "manager");
  const data = parseInput(createOrderSchema, input);

  await assertActiveLocation(db, data.locationId);
  const iceTypeId = data.iceTypeId ?? null;
  const iceTypeName = iceTypeId ? await loadIceTypeName(db, iceTypeId) : null;
  await assertExists(db, boxTypes, data.boxTypeId, "Тип тари не знайдено.");
  await assertExists(db, orderSources, data.sourceId, "Джерело не знайдено.");
  await assertAddressOfClient(db, data.addressId, data.clientId);
  const recipientPhone = parsePhone(data.recipientPhone);

  const kgSold = data.kgSold ?? "0.000";
  const method = data.deliveryMethod ?? "other";
  const auto = await autoValues(db, {
    clientId: data.clientId,
    iceTypeId,
    orderDate: data.orderDate,
    deliveryMethod: method,
    kgSold: parseDecimal(kgSold),
  });

  const hasManualPrice = data.price !== undefined && data.price !== null;
  const price = hasManualPrice
    ? parsePricePerKg(data.price as string | number)
    : (auto.price ?? "0.00");

  return withActor(db, actor.id, async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        clientId: data.clientId,
        locationId: data.locationId,
        orderDate: data.orderDate,
        iceTypeId,
        sourceId: data.sourceId ?? null,
        kgSold,
        kgToProduce: data.kgToProduce ?? auto.kgToProduce.toFixed(3),
        markupPercentApplied: auto.percent.toFixed(2),
        priceManual: hasManualPrice,
        deliveryMethod: method,
        addressId: data.addressId ?? null,
        deliveryText: data.deliveryText ?? null,
        timeWindow: data.timeWindow ?? null,
        recipientName: data.recipientName ?? null,
        recipientPhone,
        boxTypeId: data.boxTypeId ?? null,
        boxCount: data.boxCount ?? 0,
        boxOwnership: data.boxOwnership ?? "ours",
        paymentKind: data.paymentKind ?? "unknown",
        comment: data.comment ?? null,
        internalComment: data.internalComment ?? null,
      })
      .returning({ id: orders.id, number: orders.number });

    await tx.insert(orderItems).values({
      orderId: order!.id,
      kind: "ice",
      title: iceItemTitle(iceTypeName),
      qty: kgSold,
      unit: "кг",
      price,
    });
    return order!;
  });
}

// ---------------------------------------------------------------------------------------------
// Зміна
// ---------------------------------------------------------------------------------------------

/**
 * Змінює поля замовлення за правилами D58: у чернетці й підтвердженому основні поля вільно (власник,
 * менеджер), у виробництві й запакованому лише власник із приміткою (`options.note`), далі не міняються.
 * «Виготовити» і коментарі мають окремі права (старший локації своєї локації). Ціна в чернетці
 * вільно, після підтвердження лише через `changeOrderPrice`.
 */
export async function updateOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
  patch: UpdateOrderInput,
  options: { note?: string } = {},
): Promise<void> {
  const data = parseInput(updateOrderSchema, patch);
  const order = await loadOrderRow(db, orderId);
  requirePermission(actor, "orders", "write", { recordLocationId: order.locationId });
  const policy = editPolicy(order.status, actor.role);

  const changed = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as typeof data;
  const keys = Object.keys(changed);
  if (keys.length === 0) return;
  const touches = (...names: string[]) => names.some((name) => name in changed);

  if (touches(...CORE_KEYS)) {
    if (policy.core === "none") throw new ForbiddenError("Ці поля вже не можна змінювати.");
    if (policy.core === "owner_note" && !options.note?.trim()) {
      throw new ValidationError("Замовлення вже у виробництві: вкажіть причину зміни.");
    }
  }
  if (touches("price")) {
    if (policy.price === "none") throw new ForbiddenError("Ціну замовлення змінити не можна.");
    if (policy.price === "override") {
      throw new ValidationError(
        "Замовлення підтверджене: ціну змінює власник через «Змінити ціну» з приміткою.",
      );
    }
  }
  if (touches("kgToProduce") && !policy.produce) {
    throw new ForbiddenError("Кількість для виробництва змінити не можна.");
  }
  if (touches("comment") && !policy.comment) {
    throw new ForbiddenError("Коментар змінити не можна.");
  }
  if (touches("internalComment") && !policy.internalComment) {
    throw new ForbiddenError("Внутрішній коментар змінити не можна.");
  }

  const clientId = changed.clientId ?? order.clientId;
  const locationId = changed.locationId ?? order.locationId;
  if (touches("locationId")) await assertActiveLocation(db, locationId);
  if (touches("clientId")) await loadClientContext(db, clientId);
  const iceTypeId = "iceTypeId" in changed ? (changed.iceTypeId ?? null) : order.iceTypeId;
  const iceTypeName = touches("iceTypeId")
    ? iceTypeId
      ? await loadIceTypeName(db, iceTypeId)
      : null
    : undefined;
  if (touches("boxTypeId"))
    await assertExists(db, boxTypes, changed.boxTypeId, "Тип тари не знайдено.");
  if (touches("sourceId"))
    await assertExists(db, orderSources, changed.sourceId, "Джерело не знайдено.");
  if (touches("addressId", "clientId")) {
    const addressId = "addressId" in changed ? changed.addressId : order.addressId;
    await assertAddressOfClient(db, addressId, clientId);
  }

  const set: Partial<typeof orders.$inferInsert> = {};
  for (const key of keys) {
    if (key === "price") continue;
    if (key === "recipientPhone") set.recipientPhone = parsePhone(changed.recipientPhone);
    else (set as Record<string, unknown>)[key] = (changed as Record<string, unknown>)[key] ?? null;
  }
  // Поля, що не можуть бути порожніми, при `null` лишаємо без змін.
  for (const key of [
    "clientId",
    "locationId",
    "orderDate",
    "kgSold",
    "kgToProduce",
    "deliveryMethod",
    "boxCount",
    "boxOwnership",
    "paymentKind",
  ] as const) {
    if (set[key] === null) delete set[key];
  }

  const kgSold = changed.kgSold ?? order.kgSold;
  const deliveryMethodValue = changed.deliveryMethod ?? order.deliveryMethod;
  const orderDate = changed.orderDate ?? order.orderDate;

  // Ціна: вручну або за прайсом, доки замовлення чернетка (D52).
  let priceManual = order.priceManual;
  let itemPrice: string | undefined;
  if ("price" in changed) {
    if (changed.price === null) priceManual = false;
    else {
      priceManual = true;
      itemPrice = parsePricePerKg(changed.price as string | number);
    }
  }
  const mustResolve =
    order.status === "draft" &&
    !priceManual &&
    (touches("iceTypeId", "orderDate", "clientId") || changed.price === null);
  if (mustResolve) {
    const resolved = iceTypeId
      ? await resolvePrice(db, { clientId, iceTypeId, date: orderDate })
      : null;
    itemPrice = resolved?.pricePerKg ?? "0.00";
  }
  if ("price" in changed) set.priceManual = priceManual;

  // «Виготовити»: перераховуємо лише якщо воно було підказаним, а не виправленим вручну (D53).
  const wasSuggested =
    parseDecimal(order.kgToProduce) ===
    computeKgToProduce(parseDecimal(order.kgSold), parseDecimal(order.markupPercentApplied ?? "0"));
  if (!touches("kgToProduce") && wasSuggested && touches("kgSold", "deliveryMethod", "clientId")) {
    const auto = await autoValues(db, {
      clientId,
      iceTypeId,
      orderDate,
      deliveryMethod: deliveryMethodValue,
      kgSold: parseDecimal(kgSold),
    });
    set.markupPercentApplied = auto.percent.toFixed(2);
    set.kgToProduce = auto.kgToProduce.toFixed(3);
  }

  await withActor(
    db,
    actor.id,
    async (tx) => {
      const [current] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id))
        .for("update");
      if (!current || current.status !== order.status) {
        throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
      }
      if (Object.keys(set).length > 0) {
        await tx.update(orders).set(set).where(eq(orders.id, order.id));
      }
      // Позиція «Лід» іде за полями замовлення (D55).
      const itemSet: Partial<typeof orderItems.$inferInsert> = {};
      if (touches("kgSold")) itemSet.qty = kgSold;
      if (iceTypeName !== undefined) itemSet.title = iceItemTitle(iceTypeName);
      if (itemPrice !== undefined) itemSet.price = itemPrice;
      if (Object.keys(itemSet).length > 0) {
        await tx
          .update(orderItems)
          .set(itemSet)
          .where(and(eq(orderItems.orderId, order.id), eq(orderItems.kind, "ice")));
      }
    },
    { note: options.note },
  );
}

/** Видаляє чернетку (м'яко). Решту замовлень не видаляють, а скасовують (D58). */
export async function deleteDraftOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<void> {
  const order = await loadOrderRow(db, orderId);
  requirePermission(actor, "orders", "write", { recordLocationId: order.locationId });
  requireRole(actor, "owner", "manager");
  if (!canDeleteDraft(order.status, actor.role)) {
    throw new ValidationError("Видалити можна лише чернетку. Решту замовлень скасовують.");
  }
  await withActor(db, actor.id, async (tx) => {
    const [current] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id))
      .for("update");
    if (!current || current.status !== "draft") {
      throw new ValidationError("Замовлення вже змінили. Оновіть сторінку й повторіть.");
    }
    await tx.update(orders).set({ deletedAt: new Date() }).where(eq(orders.id, order.id));
  });
}

// ---------------------------------------------------------------------------------------------
// Список
// ---------------------------------------------------------------------------------------------

export type OrderListQuery = {
  /** Дата виконання від і до включно (YYYY-MM-DD). */
  dateFrom?: string;
  dateTo?: string;
  statuses?: OrderStatus[];
  /** Менеджер клієнта (клієнт закріплений за менеджером, B4). */
  managerId?: string;
  deliveryMethod?: string;
  /** Локація: для ролі з локацією завжди її власна. */
  locationId?: string;
  /** Номер замовлення або пошук клієнта (код, назва, телефон, контакт). */
  search?: string;
  offset?: number;
  limit?: number;
};

export type OrderListPage = { items: OrderListItem[]; hasMore: boolean };

/** Список замовлень частинами (по 30): нові дати першими. Видалені чернетки приховано. */
export async function listOrders(
  db: AnyPgDatabase,
  actor: AppUser,
  query: OrderListQuery = {},
): Promise<OrderListPage> {
  requirePermission(actor, "orders", "read", { anyLocation: true });
  const limit = Math.min(Math.max(query.limit ?? ORDERS_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions: (SQL | undefined)[] = [isNull(orders.deletedAt)];
  if (isOwnLocationOnly(actor.role, "orders")) {
    // «св.»: роль з локацією бачить лише свою; без локації нічого.
    if (!actor.locationId) return { items: [], hasMore: false };
    conditions.push(eq(orders.locationId, actor.locationId));
  } else if (query.locationId) {
    conditions.push(eq(orders.locationId, parseInput(uuid, query.locationId)));
  }
  if (query.dateFrom) {
    conditions.push(gte(orders.orderDate, parseInput(dateField, query.dateFrom)));
  }
  if (query.dateTo) conditions.push(lte(orders.orderDate, parseInput(dateField, query.dateTo)));
  if (query.statuses?.length) {
    const statuses = query.statuses.map((status) =>
      parseInput(z.enum(orderStatus.enumValues, "Невідомий статус."), status),
    );
    conditions.push(inArray(orders.status, statuses));
  }
  if (query.managerId) conditions.push(eq(clients.managerId, parseInput(uuid, query.managerId)));
  if (query.deliveryMethod) {
    conditions.push(
      eq(
        orders.deliveryMethod,
        parseInput(
          z.enum(deliveryMethod.enumValues, "Невідомий спосіб доставки."),
          query.deliveryMethod,
        ),
      ),
    );
  }
  const search = (query.search ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
  if (search) {
    const numberText = search.replace(/^№\s*/, "");
    const byNumber = /^[0-9]{1,9}$/.test(numberText)
      ? sql`${orders.number} = ${Number(numberText)}`
      : undefined;
    conditions.push(or(byNumber, clientSearchCondition(search)));
  }

  const rows = await db
    .select({
      order: orders,
      clientCode: clients.code,
      clientName: clients.name,
      locationName: locations.name,
      iceTypeName: iceTypes.name,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .where(and(...conditions))
    .orderBy(desc(orders.orderDate), desc(orders.number))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows
      .slice(0, limit)
      .map(({ order, ...names }) => toOrderListItem(order, names, actor.role)),
    hasMore: rows.length > limit,
  };
}

// ---------------------------------------------------------------------------------------------
// Картка
// ---------------------------------------------------------------------------------------------

/**
 * Картка замовлення з позиціями, історією статусів і (за правом на гроші) змінами ціни. `null`,
 * якщо замовлення немає, воно видалене або це замовлення чужої локації для ролі з локацією
 * (404, а не «заборонено»).
 */
export async function getOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<OrderCardView | null> {
  requirePermission(actor, "orders", "read", { anyLocation: true });
  const id = parseInput(uuid, orderId);

  const [row] = await db
    .select({
      order: orders,
      clientCode: clients.code,
      clientName: clients.name,
      locationName: locations.name,
      iceTypeName: iceTypes.name,
      sourceName: orderSources.name,
      boxTypeName: boxTypes.name,
      address: clientAddresses,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .leftJoin(orderSources, eq(orderSources.id, orders.sourceId))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .leftJoin(clientAddresses, eq(clientAddresses.id, orders.addressId))
    .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (isOwnLocationOnly(actor.role, "orders") && row.order.locationId !== actor.locationId) {
    return null;
  }

  const sawMoney = can(actor.role, "order_money", "read");
  const [items, history, changes] = await Promise.all([
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id))
      .orderBy(sql`(${orderItems.kind} = 'ice') desc`, asc(orderItems.createdAt)),
    db
      .select({ row: orderStatusHistory, changedByName: profiles.fullName })
      .from(orderStatusHistory)
      .leftJoin(profiles, eq(profiles.id, orderStatusHistory.changedBy))
      .where(eq(orderStatusHistory.orderId, id))
      .orderBy(asc(orderStatusHistory.changedAt)),
    sawMoney
      ? db
          .select({ row: orderPriceChanges, changedByName: profiles.fullName })
          .from(orderPriceChanges)
          .leftJoin(profiles, eq(profiles.id, orderPriceChanges.changedBy))
          .where(eq(orderPriceChanges.orderId, id))
          .orderBy(desc(orderPriceChanges.changedAt))
      : Promise.resolve(null),
  ]);

  const address = row.address;
  const addressText = address
    ? [
        address.cityText,
        address.addressText,
        address.npWarehouseNumber ? `відділення № ${address.npWarehouseNumber}` : null,
      ]
        .filter(Boolean)
        .join(", ") ||
      address.label ||
      null
    : null;

  return toOrderCardView(
    row.order,
    {
      clientCode: row.clientCode,
      clientName: row.clientName,
      locationName: row.locationName,
      iceTypeName: row.iceTypeName,
      sourceName: row.sourceName,
      boxTypeName: row.boxTypeName,
      addressText,
    },
    items,
    history.map((entry) => toOrderHistoryItem(entry.row, entry.changedByName)),
    changes ? changes.map((entry) => toPriceChangeView(entry.row, entry.changedByName)) : null,
    actor.role,
  );
}
