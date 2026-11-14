import { and, asc, desc, eq, inArray, isNull, like, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import {
  boxEvents,
  boxes,
  boxTypes,
  clients,
  locations,
  orderItems,
  orders,
  profiles,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "./errors";
import { ForbiddenError, type AppUser, locationScope, requirePermission } from "./guards";
import {
  applyBoxAction,
  BOX_STATUS_LABELS,
  type BoxAction,
  type BoxEventKind,
  type BoxStatus,
  canDoBoxAction,
  canIssueBoxesToOrder,
  formatBoxCode,
  parseBoxCode,
} from "./box-rules";
import { closeIfDone } from "./order-status";

/**
 * Оборотні бокси: створення партії, події (видача, повернення, продаж, втрата, списання,
 * переміщення) і картка бокса (B9, D104–D109). Усі записи йдуть через `withActor`, подія з боксом не
 * змінюється й не видаляється (тригер бази). Грошей тут немає.
 */

export const MAX_BOXES_PER_BATCH = 500;
/** Час скана не може бути з далекого майбутнього чи глибокого минулого (збитий годинник телефона). */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const MAX_PAST_MS = 366 * 24 * 60 * 60 * 1000;

function assertCanScan(actor: AppUser): void {
  requirePermission(actor, "box_scan", "write", { anyLocation: true });
}

/** Створювати бокси й друкувати наклейки можуть власник і старший локації (реєстр, ТЗ 6.7). */
function assertCanManageRegistry(actor: AppUser, locationId: string): void {
  if (actor.role !== "owner" && actor.role !== "location_lead") throw new ForbiddenError();
  requirePermission(actor, "box_scan", "write", { recordLocationId: locationId });
}

// ---------------------------------------------------------------------------------------------
// Створення партії боксів
// ---------------------------------------------------------------------------------------------

export type CreateBoxesInput = { boxTypeId: string; locationId: string; count: number };

/**
 * Створює партію боксів з кодами без дір і повторів (D105): `K-0001`, `K-0002`…, далі за найбільшим
 * номером локації. Дві одночасні партії не отримають однакових кодів: номери видаються під
 * замком на префікс. Повертає коди в порядку створення.
 */
export async function createBoxes(
  db: AnyPgDatabase,
  actor: AppUser,
  input: CreateBoxesInput,
): Promise<{ codes: string[] }> {
  const boxTypeId = parseInput(z.string().uuid("Оберіть тип бокса."), input.boxTypeId);
  const locationId = parseInput(z.string().uuid("Оберіть локацію."), input.locationId);
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_BOXES_PER_BATCH) {
    throw new ValidationError(`Кількість боксів від 1 до ${MAX_BOXES_PER_BATCH}.`);
  }
  assertCanManageRegistry(actor, locationId);

  return withActor(db, actor.id, async (tx) => {
    const [location] = await tx
      .select({ id: locations.id, prefix: locations.boxPrefix })
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!location) throw new ValidationError("Локацію не знайдено.");
    if (!location.prefix) throw new ValidationError("У локації немає префікса для кодів боксів.");
    const [type] = await tx
      .select({
        id: boxTypes.id,
        isActive: boxTypes.isActive,
        isClientOwned: boxTypes.isClientOwned,
      })
      .from(boxTypes)
      .where(eq(boxTypes.id, boxTypeId));
    if (!type) throw new ValidationError("Тип бокса не знайдено.");
    if (!type.isActive) throw new ValidationError("Цей тип бокса вимкнено.");
    if (type.isClientOwned) throw new ValidationError("Бокси клієнтів не облікуємо наклейками.");

    // Замок на префікс: два запити одночасно видають номери по черзі.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`boxes:${location.prefix}`}))`);
    const [last] = await tx
      .select({
        max: sql<number | null>`max(substring(${boxes.code} from '[0-9]+$')::int)`,
      })
      .from(boxes)
      .where(like(boxes.code, `${location.prefix}-%`));
    const first = (last?.max ?? 0) + 1;
    const codes = Array.from({ length: count }, (_, i) =>
      formatBoxCode(location.prefix!, first + i),
    );

    const created = await tx
      .insert(boxes)
      .values(codes.map((code) => ({ code, boxTypeId, locationId })))
      .returning({ id: boxes.id, code: boxes.code });
    const now = new Date();
    await tx.insert(boxEvents).values(
      created.map((box) => ({
        boxId: box.id,
        event: "created" as const,
        locationId,
        actorId: actor.id,
        occurredAt: now,
      })),
    );
    return { codes: created.map((box) => box.code).sort() };
  });
}

/** Позначає наклейки надрукованими (подія «наклейку надруковано»). Повертає, скільки боксів оновлено. */
export async function markLabelsPrinted(
  db: AnyPgDatabase,
  actor: AppUser,
  rawCodes: string[],
): Promise<{ count: number }> {
  const codes = rawCodes.map((raw) => {
    const code = parseBoxCode(raw);
    if (!code) throw new ValidationError(`Некоректний код бокса: ${raw}.`);
    return code;
  });
  if (codes.length === 0 || codes.length > MAX_BOXES_PER_BATCH) {
    throw new ValidationError(`Кодів від 1 до ${MAX_BOXES_PER_BATCH}.`);
  }
  return withActor(db, actor.id, async (tx) => {
    const rows = await tx
      .select({ id: boxes.id, locationId: boxes.locationId })
      .from(boxes)
      .where(inArray(boxes.code, codes))
      .for("update");
    if (rows.length !== new Set(codes).size)
      throw new ValidationError("Деяких боксів не знайдено.");
    for (const row of rows) assertCanManageRegistry(actor, row.locationId);
    const now = new Date();
    await tx
      .update(boxes)
      .set({ labelPrintedAt: now })
      .where(
        inArray(
          boxes.id,
          rows.map((r) => r.id),
        ),
      );
    await tx.insert(boxEvents).values(
      rows.map((row) => ({
        boxId: row.id,
        event: "label_printed" as const,
        locationId: row.locationId,
        actorId: actor.id,
        occurredAt: now,
      })),
    );
    return { count: rows.length };
  });
}

// ---------------------------------------------------------------------------------------------
// Події: видача, повернення, продаж, втрата, списання, переміщення
// ---------------------------------------------------------------------------------------------

export type RecordBoxEventInput = {
  /** Код з QR чи введений вручну: `K-0001` або адреса `…/b/K-0001`. */
  code: string;
  action: BoxAction;
  /** Для видачі й продажу: замовлення. */
  orderId?: string | null;
  /** Для переміщення: куди. */
  toLocationId?: string | null;
  note?: string | null;
  /** Коли відсканували на пристрої (ISO). За замовчуванням зараз. */
  occurredAt?: string;
  /** Номер скана в офлайн-черзі: повторна відправка не дублює (D112). */
  deviceQueueId?: string | null;
};

export type BoxEventResult = {
  code: string;
  status: "ok" | "warning";
  /** Що показати: «Видано», «Повернено від ДСВ, був 12 днів», текст попередження. */
  message: string;
  /** Цю подію вже записували (повторна відправка). */
  duplicate: boolean;
  boxStatus: BoxStatus;
  /** Замовлення основної події (для оновлення екрана цеху). */
  orderId?: string | null;
};

const ACTION_DONE: Record<BoxAction, string> = {
  issue: "Видано",
  return: "Повернено",
  sell: "Продано",
  lose: "Позначено втраченим",
  find: "Знайдено, бокс на складі",
  retire: "Списано",
  transfer: "Переміщено",
};

/** Скільки днів бокс був у клієнта: за київськими днями від видачі. */
export function daysAtClient(issuedAt: Date, now: Date): number {
  const kyivDay = (d: Date) => {
    const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" })
      .format(d)
      .split("-")
      .map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.round((kyivDay(now) - kyivDay(issuedAt)) / 86_400_000));
}

function parseOccurredAt(raw: string | undefined, now: Date): Date {
  if (!raw) return now;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new ValidationError("Некоректний час скана.");
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS || at.getTime() < now.getTime() - MAX_PAST_MS) {
    throw new ValidationError("Час скана поза допустимими межами: перевірте годинник телефона.");
  }
  return at;
}

/**
 * Записує дію з боксом за правилами ТЗ 5.2 (`box-rules.ts`). Повторна відправка з тим самим
 * `deviceQueueId` нічого не дублює й повертає `duplicate: true`. Після повернення чи продажу
 * оплачене замовлення, у якого не лишилось боксів «У клієнта», закривається саме (D109).
 */
export async function recordBoxEvent(
  db: AnyPgDatabase,
  actor: AppUser,
  input: RecordBoxEventInput,
): Promise<BoxEventResult> {
  assertCanScan(actor);
  if (!canDoBoxAction(actor.role, input.action)) throw new ForbiddenError();
  if (input.action === "lose" || input.action === "retire") {
    requirePermission(actor, "box_writeoff", "write");
  }
  const code = parseBoxCode(input.code);
  if (!code) throw new ValidationError("Некоректний код бокса.");
  const queueId = input.deviceQueueId?.trim() || null;
  if (queueId && queueId.length > 100) throw new ValidationError("Некоректний номер скана.");
  const now = new Date();
  const occurredAt = parseOccurredAt(input.occurredAt, now);

  if (queueId) {
    const [seen] = await db
      .select({ boxId: boxEvents.boxId })
      .from(boxEvents)
      .where(eq(boxEvents.deviceQueueId, queueId))
      .limit(1);
    if (seen) {
      const [box] = await db
        .select({ code: boxes.code, status: boxes.status })
        .from(boxes)
        .where(eq(boxes.id, seen.boxId));
      return {
        code: box?.code ?? code,
        status: "ok",
        message: "Уже записано раніше.",
        duplicate: true,
        boxStatus: box?.status ?? "in_stock",
      };
    }
  }

  const result = await withActor(db, actor.id, async (tx) => {
    const [box] = await tx.select().from(boxes).where(eq(boxes.code, code)).for("update");
    if (!box) throw new ValidationError("Бокс не знайдено.");

    let orderRef: { id: string; clientId: string } | null = null;
    let orderLocationId: string | null = null;
    if (input.action === "issue" || input.action === "sell") {
      const orderId = parseInput(z.string().uuid("Оберіть замовлення."), input.orderId);
      const [order] = await tx
        .select({
          id: orders.id,
          clientId: orders.clientId,
          status: orders.status,
          locationId: orders.locationId,
          deletedAt: orders.deletedAt,
        })
        .from(orders)
        .where(eq(orders.id, orderId));
      if (!order || order.deletedAt) throw new ValidationError("Замовлення не знайдено.");
      if (input.action === "issue") {
        if (!canIssueBoxesToOrder(order.status)) {
          throw new ValidationError("Бокси видають до замовлень «У виробництві» чи «Запаковано».");
        }
        // Старший локації й виробництво працюють лише зі своєю локацією (матриця, «св.»).
        requirePermission(actor, "box_scan", "write", { recordLocationId: order.locationId });
      } else if (order.status === "cancelled") {
        throw new ValidationError("Замовлення скасоване.");
      }
      orderRef = { id: order.id, clientId: order.clientId };
      orderLocationId = order.locationId;
    }

    let toLocationId: string | null = null;
    if (input.action === "transfer") {
      toLocationId = parseInput(z.string().uuid("Оберіть локацію."), input.toLocationId);
      if (toLocationId === box.locationId) throw new ValidationError("Бокс уже в цій локації.");
      const [target] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.id, toLocationId));
      if (!target) throw new ValidationError("Локацію не знайдено.");
    }

    const planned = applyBoxAction(
      {
        status: box.status,
        currentClientId: box.currentClientId,
        currentOrderId: box.currentOrderId,
      },
      input.action,
      orderRef,
    );
    if (!planned.ok) throw new ValidationError(planned.error);

    const patch: Partial<typeof boxes.$inferInsert> = {
      status: planned.next.status,
      currentClientId: planned.next.currentClientId,
      currentOrderId: planned.next.currentOrderId,
    };
    if (planned.next.status === "at_client") patch.issuedAt = occurredAt;
    else patch.issuedAt = null;
    if (planned.next.status === "retired") {
      patch.retiredAt = occurredAt;
      patch.retireReason = input.note?.trim() || null;
    }
    if (input.action === "transfer") patch.locationId = toLocationId!;
    await tx.update(boxes).set(patch).where(eq(boxes.id, box.id));

    const eventLocationId = actor.locationId ?? orderLocationId ?? box.locationId;
    const lastIndex = planned.events.length - 1;
    await tx.insert(boxEvents).values(
      planned.events.map((planEvent, index) => ({
        boxId: box.id,
        event: planEvent.event as BoxEventKind,
        orderId: planEvent.orderId,
        clientId: planEvent.clientId,
        locationId: eventLocationId,
        actorId: actor.id,
        occurredAt,
        // Номер скана лише на основній події: неявне повернення йому не належить.
        deviceQueueId: index === lastIndex ? queueId : null,
        note:
          [planEvent.note, index === lastIndex ? input.note?.trim() : null]
            .filter(Boolean)
            .join(". ") || null,
      })),
    );

    // Кого й з яких днів повернули: для рядка «Повернено від ДСВ, був 12 днів».
    let message = ACTION_DONE[input.action];
    if (input.action === "return" && !planned.unchanged && box.currentClientId) {
      const [client] = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, box.currentClientId));
      const days = box.issuedAt ? daysAtClient(box.issuedAt, occurredAt) : null;
      message = `Повернено від ${client?.name ?? "клієнта"}${days === null ? "" : `, був ${days} дн.`}`;
    }
    if (planned.warning) message = planned.warning;
    return {
      result: {
        code,
        status: planned.warning ? ("warning" as const) : ("ok" as const),
        message,
        duplicate: false,
        boxStatus: planned.next.status,
        orderId: planned.events.at(-1)?.orderId ?? null,
      },
      // Замовлення, з яких бокс пішов у «не в клієнта»: їх можна було закрити.
      releasedOrderIds: planned.events
        .filter((e) => e.event === "returned" || e.event === "sold")
        .map((e) => e.orderId)
        .filter((id): id is string => id !== null),
    };
  });

  for (const orderId of new Set(result.releasedOrderIds)) {
    await closeIfDone(db, orderId);
  }
  return result.result;
}

// ---------------------------------------------------------------------------------------------
// Картка бокса
// ---------------------------------------------------------------------------------------------

export type BoxHistoryItem = {
  id: string;
  event: BoxEventKind;
  occurredAt: string;
  actorName: string;
  clientName: string | null;
  orderNumber: number | null;
  note: string | null;
};

export type BoxCard = {
  id: string;
  code: string;
  boxTypeName: string;
  locationName: string;
  status: BoxStatus;
  statusLabel: string;
  clientId: string | null;
  clientName: string | null;
  orderId: string | null;
  orderNumber: number | null;
  issuedAt: string | null;
  labelPrintedAt: string | null;
  history: BoxHistoryItem[];
};

/** Картка бокса з історією подій (ТЗ 6.7). Читають ті, хто сканує. `null`, якщо коду немає. */
export async function getBoxByCode(
  db: AnyPgDatabase,
  actor: AppUser,
  rawCode: string,
): Promise<BoxCard | null> {
  assertCanScan(actor);
  const code = parseBoxCode(rawCode);
  if (!code) return null;
  const [row] = await db
    .select({
      box: boxes,
      boxTypeName: boxTypes.name,
      locationName: locations.name,
      clientName: clients.name,
      orderNumber: orders.number,
    })
    .from(boxes)
    .innerJoin(boxTypes, eq(boxTypes.id, boxes.boxTypeId))
    .innerJoin(locations, eq(locations.id, boxes.locationId))
    .leftJoin(clients, eq(clients.id, boxes.currentClientId))
    .leftJoin(orders, eq(orders.id, boxes.currentOrderId))
    .where(eq(boxes.code, code));
  if (!row) return null;

  const history = await db
    .select({
      id: boxEvents.id,
      event: boxEvents.event,
      occurredAt: boxEvents.occurredAt,
      actorName: profiles.fullName,
      clientName: clients.name,
      orderNumber: orders.number,
      note: boxEvents.note,
    })
    .from(boxEvents)
    .innerJoin(profiles, eq(profiles.id, boxEvents.actorId))
    .leftJoin(clients, eq(clients.id, boxEvents.clientId))
    .leftJoin(orders, eq(orders.id, boxEvents.orderId))
    .where(eq(boxEvents.boxId, row.box.id))
    .orderBy(desc(boxEvents.occurredAt), desc(boxEvents.recordedAt));
  return {
    id: row.box.id,
    code: row.box.code,
    boxTypeName: row.boxTypeName,
    locationName: row.locationName,
    status: row.box.status,
    statusLabel: BOX_STATUS_LABELS[row.box.status],
    clientId: row.box.currentClientId,
    clientName: row.clientName,
    orderId: row.box.currentOrderId,
    orderNumber: row.orderNumber,
    issuedAt: row.box.issuedAt?.toISOString() ?? null,
    labelPrintedAt: row.box.labelPrintedAt?.toISOString() ?? null,
    history: history.map((h) => ({ ...h, occurredAt: h.occurredAt.toISOString() })),
  };
}

// ---------------------------------------------------------------------------------------------
// Реєстр: список боксів
// ---------------------------------------------------------------------------------------------

export const BOXES_PAGE_SIZE = 30;

export type BoxListQuery = {
  locationId?: string;
  status?: BoxStatus;
  boxTypeId?: string;
  /** Частина коду бокса. */
  search?: string;
  limit?: number;
};

export type BoxListItem = {
  id: string;
  code: string;
  boxTypeName: string;
  locationName: string;
  status: BoxStatus;
  statusLabel: string;
  clientName: string | null;
  issuedAt: string | null;
};

/** Реєстр (ТЗ 6.7): власник і старший локації; старший бачить лише свою локацію. Нові коди першими. */
export async function listBoxes(
  db: AnyPgDatabase,
  actor: AppUser,
  query: BoxListQuery = {},
): Promise<{ items: BoxListItem[]; hasMore: boolean }> {
  if (actor.role !== "owner" && actor.role !== "location_lead") throw new ForbiddenError();
  requirePermission(actor, "box_scan", "write", { anyLocation: true });
  const limit = Math.min(Math.max(query.limit ?? BOXES_PAGE_SIZE, 1), 300);
  const own = locationScope(actor);
  if (actor.role === "location_lead" && !own) return { items: [], hasMore: false };

  const conditions: (SQL | undefined)[] = [];
  const locationId = own ?? query.locationId;
  if (locationId) conditions.push(eq(boxes.locationId, parseInput(z.string().uuid(), locationId)));
  if (query.status) conditions.push(eq(boxes.status, query.status));
  if (query.boxTypeId)
    conditions.push(eq(boxes.boxTypeId, parseInput(z.string().uuid(), query.boxTypeId)));
  const search = query.search
    ?.trim()
    .toUpperCase()
    .replace(/[%_\\]/g, "");
  if (search) conditions.push(like(boxes.code, `%${search}%`));

  const rows = await db
    .select({
      id: boxes.id,
      code: boxes.code,
      boxTypeName: boxTypes.name,
      locationName: locations.name,
      status: boxes.status,
      clientName: clients.name,
      issuedAt: boxes.issuedAt,
    })
    .from(boxes)
    .innerJoin(boxTypes, eq(boxTypes.id, boxes.boxTypeId))
    .innerJoin(locations, eq(locations.id, boxes.locationId))
    .leftJoin(clients, eq(clients.id, boxes.currentClientId))
    .where(and(...conditions))
    .orderBy(desc(boxes.createdAt), desc(boxes.code))
    .limit(limit + 1);
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...row,
      statusLabel: BOX_STATUS_LABELS[row.status],
      issuedAt: row.issuedAt?.toISOString() ?? null,
    })),
    hasMore: rows.length > limit,
  };
}

/** Типи тари, з яких створюють бокси: активні й не «бокс клієнта». */
export async function listBoxTypeOptions(
  db: AnyPgDatabase,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: boxTypes.id, name: boxTypes.name })
    .from(boxTypes)
    .where(and(eq(boxTypes.isActive, true), eq(boxTypes.isClientOwned, false)))
    .orderBy(asc(boxTypes.sort));
}

// ---------------------------------------------------------------------------------------------
// Скан: пакет подій, замовлення для видачі, лічильники
// ---------------------------------------------------------------------------------------------

export const MAX_EVENTS_PER_BATCH = 20;

export type BoxEventOutcome = {
  /** Номер скана, який прислав пристрій (щоб зіставити відповідь із записом у черзі). */
  queueId: string | null;
  code: string;
  result: "ok" | "warning" | "error";
  message: string;
  duplicate: boolean;
  boxStatus?: BoxStatus;
  orderId?: string | null;
};

/**
 * Пакет подій зі сканера (ТЗ §9): до 20 штук, у порядку часу скана. Кожна подія дає `ok`,
 * `warning` чи `error` із текстом; помилка однієї не зупиняє решту. Повторна відправка того ж
 * номера скана безпечна (D112).
 */
export async function processBoxEvents(
  db: AnyPgDatabase,
  actor: AppUser,
  events: RecordBoxEventInput[],
): Promise<BoxEventOutcome[]> {
  assertCanScan(actor);
  if (events.length === 0 || events.length > MAX_EVENTS_PER_BATCH) {
    throw new ValidationError(`У пакеті від 1 до ${MAX_EVENTS_PER_BATCH} подій.`);
  }
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        new Date(a.event.occurredAt ?? 0).getTime() - new Date(b.event.occurredAt ?? 0).getTime() ||
        a.index - b.index,
    );
  const outcomes = new Array<BoxEventOutcome>(events.length);
  for (const { event, index } of ordered) {
    const base = { queueId: event.deviceQueueId ?? null, code: String(event.code ?? "").trim() };
    try {
      const done = await recordBoxEvent(db, actor, event);
      outcomes[index] = {
        ...base,
        code: done.code,
        result: done.status,
        message: done.message,
        duplicate: done.duplicate,
        boxStatus: done.boxStatus,
        orderId: done.orderId ?? null,
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ForbiddenError) {
        outcomes[index] = {
          ...base,
          result: "error",
          message: error.message,
          duplicate: false,
        };
      } else {
        throw error;
      }
    }
  }
  return outcomes;
}

export type BoxIssueOrder = {
  id: string;
  number: number | null;
  clientName: string;
  /** Скільки боксів потрібно (тара «наша» × кількість). */
  needed: number;
  /** Скільки вже відскановано в це замовлення. */
  issued: number;
  boxTypeName: string | null;
};

/** Скільки боксів «У клієнта» числиться в кожному із замовлень. */
export async function countIssuedBoxes(
  db: AnyPgDatabase,
  orderIds: readonly string[],
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ orderId: boxes.currentOrderId, n: sql<number>`count(*)::int` })
    .from(boxes)
    .where(and(inArray(boxes.currentOrderId, [...orderIds]), eq(boxes.status, "at_client")))
    .groupBy(boxes.currentOrderId);
  return new Map(rows.map((row) => [row.orderId!, row.n]));
}

/**
 * Замовлення, до яких зараз видають бокси (ТЗ 6.7): сьогоднішні «У виробництві» і «Запаковано».
 * Старший локації й виробництво бачать свою локацію, власник усі.
 */
export async function listBoxIssueOrders(
  db: AnyPgDatabase,
  actor: AppUser,
  today: string,
): Promise<BoxIssueOrder[]> {
  assertCanScan(actor);
  const own = locationScope(actor);
  if (actor.role !== "owner" && !own) return [];
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      clientName: clients.name,
      boxCount: orders.boxCount,
      boxOwnership: orders.boxOwnership,
      boxTypeName: boxTypes.name,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.orderDate, today),
        inArray(orders.status, ["in_production", "packed"]),
        own ? eq(orders.locationId, own) : undefined,
      ),
    )
    .orderBy(asc(orders.number));
  const issued = await countIssuedBoxes(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    clientName: row.clientName,
    needed: row.boxOwnership === "ours" ? row.boxCount : 0,
    issued: issued.get(row.id) ?? 0,
    boxTypeName: row.boxTypeName,
  }));
}

export type OrderBox = { code: string; statusLabel: string; status: BoxStatus };

/** Бокси замовлення для його картки: видані (ще в клієнта) і продані в цьому замовленні. */
export async function listOrderBoxes(db: AnyPgDatabase, orderId: string): Promise<OrderBox[]> {
  const issued = await db
    .select({ code: boxes.code, status: boxes.status })
    .from(boxes)
    .where(and(eq(boxes.currentOrderId, orderId), eq(boxes.status, "at_client")));
  const sold = await db
    .selectDistinct({ code: boxes.code, status: boxes.status })
    .from(boxEvents)
    .innerJoin(boxes, eq(boxes.id, boxEvents.boxId))
    .where(
      and(eq(boxEvents.orderId, orderId), eq(boxEvents.event, "sold"), eq(boxes.status, "sold")),
    );
  return [...issued, ...sold]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((row) => ({ ...row, statusLabel: BOX_STATUS_LABELS[row.status] }));
}

const SELL_ORDER_STATUSES = ["draft", "confirmed", "in_production", "packed", "shipped"];

/**
 * Продаж бокса в замовленні (D108): бокс стає «Продано», у замовленні з'являється позиція «Продаж
 * боксу» (тип, 1 шт., ціна з типу тари, 0 ₴ якщо ціну не задано: тоді її правлять у позиції).
 * Роблять власник і старший локації (своєї локації).
 */
export async function sellBoxToOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { orderId: string; code: string },
): Promise<{ message: string; priceMissing: boolean }> {
  if (!canDoBoxAction(actor.role, "sell")) throw new ForbiddenError();
  const orderId = parseInput(z.string().uuid("Замовлення не знайдено."), input.orderId);
  const code = parseBoxCode(input.code);
  if (!code) throw new ValidationError("Некоректний код бокса.");

  const [order] = await db
    .select({
      id: orders.id,
      status: orders.status,
      locationId: orders.locationId,
      deletedAt: orders.deletedAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || order.deletedAt) throw new ValidationError("Замовлення не знайдено.");
  requirePermission(actor, "box_scan", "write", { recordLocationId: order.locationId });
  if (!SELL_ORDER_STATUSES.includes(order.status)) {
    throw new ValidationError("У це замовлення бокс продати не можна.");
  }
  const [box] = await db
    .select({
      id: boxes.id,
      typeId: boxes.boxTypeId,
      typeName: boxTypes.name,
      price: boxTypes.salePrice,
    })
    .from(boxes)
    .innerJoin(boxTypes, eq(boxTypes.id, boxes.boxTypeId))
    .where(eq(boxes.code, code));
  if (!box) throw new ValidationError("Бокс не знайдено.");

  // Подія (і перевірка, що бокс можна продати) першою: позиція з'являється лише після неї.
  await recordBoxEvent(db, actor, { code, action: "sell", orderId });
  await withActor(db, actor.id, async (tx) => {
    await tx.insert(orderItems).values({
      orderId,
      kind: "box_sale",
      title: `Продаж боксу ${box.typeName}`,
      qty: "1",
      unit: "шт",
      price: box.price ?? "0",
      boxTypeId: box.typeId,
    });
  });
  return {
    message: `Продано бокс ${code}.`,
    priceMissing: box.price === null,
  };
}
