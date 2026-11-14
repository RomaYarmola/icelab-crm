import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { rowsOf } from "@/db/rows";
import { boxDebtsLegacy, boxes, boxTypes, clients, locations } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "./errors";
import { ForbiddenError, type AppUser, locationScope, requirePermission } from "./guards";
import { daysAtClient } from "./boxes";

/**
 * Борги по боксах, старі борги «за таблицею» і склад (B9, ТЗ 4.4, D113, D114). Борг клієнта по типу
 * це бокси «У клієнта» плюс старі борги мінус закриті: рахує подання `box_debts`. Виробництво
 * боргів не бачить (D113): його екран це сканер.
 */

/** Борги бачать усі, хто має право читати борги, крім виробництва. */
function assertCanSeeDebts(actor: AppUser): void {
  requirePermission(actor, "box_debts_stock", "read", { anyLocation: true });
  if (actor.role === "production") throw new ForbiddenError();
}

/** Старі борги вносять і закривають власник і старший локації. */
function assertCanManageLegacy(actor: AppUser): void {
  if (actor.role !== "owner" && actor.role !== "location_lead") throw new ForbiddenError();
  requirePermission(actor, "box_scan", "write", { anyLocation: true });
}

export type BoxDebtRow = {
  clientId: string;
  clientCode: string;
  clientName: string;
  boxTypeId: string;
  boxTypeName: string;
  /** Усього боксів на клієнті (з наклейками й «за таблицею»). */
  total: number;
  /** З них з наклейками (QR). */
  qrCount: number;
  /** З них «за таблицею». */
  legacyCount: number;
  /** Найстарішого з боргів: день `YYYY-MM-DD` за Києвом. */
  oldestDay: string | null;
  /** Скільки днів минуло від найстарішого. */
  days: number | null;
};

type RawDebt = {
  client_id: string;
  client_code: string;
  client_name: string;
  box_type_id: string;
  box_type_name: string;
  total_count: number;
  qr_count: number;
  legacy_count: number;
  oldest_at: string | Date | null;
};

function toDebtRow(raw: RawDebt, now: Date): BoxDebtRow {
  const oldest = raw.oldest_at ? new Date(raw.oldest_at) : null;
  return {
    clientId: raw.client_id,
    clientCode: raw.client_code,
    clientName: raw.client_name,
    boxTypeId: raw.box_type_id,
    boxTypeName: raw.box_type_name,
    total: Number(raw.total_count),
    qrCount: Number(raw.qr_count),
    legacyCount: Number(raw.legacy_count),
    oldestDay: oldest
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(oldest)
      : null,
    days: oldest ? daysAtClient(oldest, now) : null,
  };
}

/**
 * Борги за клієнтами й типами, найдавніші першими (ТЗ 6.7). `clientId` звужує до одного клієнта
 * (вкладка «Бокси» на картці). Читає подання `box_debts` через `rowsOf`: результат `db.execute`
 * у справжнього драйвера й у тестового різний.
 */
export async function listBoxDebts(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { clientId?: string; now?: Date } = {},
): Promise<BoxDebtRow[]> {
  assertCanSeeDebts(actor);
  const clientId = options.clientId ? parseInput(z.string().uuid(), options.clientId) : null;
  const result = await db.execute(sql`
    select d.client_id, c.code as client_code, c.name as client_name,
           d.box_type_id, t.name as box_type_name,
           d.total_count, d.qr_count, d.legacy_count, d.oldest_at
      from box_debts d
      join clients c on c.id = d.client_id
      join box_types t on t.id = d.box_type_id
     where d.total_count > 0
       ${clientId ? sql`and d.client_id = ${clientId}` : sql``}
     order by d.oldest_at asc nulls last, c.name asc, t.sort asc
  `);
  const now = options.now ?? new Date();
  return rowsOf<RawDebt>(result).map((row) => toDebtRow(row, now));
}

// ---------------------------------------------------------------------------------------------
// Старі борги «за таблицею»
// ---------------------------------------------------------------------------------------------

export type LegacyDebtItem = {
  id: string;
  clientId: string;
  clientName: string;
  boxTypeName: string;
  count: number;
  resolvedCount: number;
  openCount: number;
  sinceDate: string | null;
  sourceRow: string | null;
};

/** Відкриті старі борги (ще не закриті повністю), найдавніші першими. */
export async function listLegacyDebts(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { clientId?: string } = {},
): Promise<LegacyDebtItem[]> {
  assertCanSeeDebts(actor);
  const clientId = options.clientId ? parseInput(z.string().uuid(), options.clientId) : null;
  const rows = await db
    .select({
      id: boxDebtsLegacy.id,
      clientId: boxDebtsLegacy.clientId,
      clientName: clients.name,
      boxTypeName: boxTypes.name,
      count: boxDebtsLegacy.count,
      resolvedCount: boxDebtsLegacy.resolvedCount,
      sinceDate: boxDebtsLegacy.sinceDate,
      sourceRow: boxDebtsLegacy.sourceRow,
    })
    .from(boxDebtsLegacy)
    .innerJoin(clients, eq(clients.id, boxDebtsLegacy.clientId))
    .innerJoin(boxTypes, eq(boxTypes.id, boxDebtsLegacy.boxTypeId))
    .where(
      and(
        sql`${boxDebtsLegacy.count} > ${boxDebtsLegacy.resolvedCount}`,
        clientId ? eq(boxDebtsLegacy.clientId, clientId) : undefined,
      ),
    )
    .orderBy(asc(boxDebtsLegacy.sinceDate), asc(clients.name));
  return rows.map((row) => ({ ...row, openCount: row.count - row.resolvedCount }));
}

export const MAX_LEGACY_COUNT = 1000;

const legacySchema = z.object({
  clientId: z.string().uuid("Оберіть клієнта."),
  boxTypeId: z.string().uuid("Оберіть тип бокса."),
  count: z
    .number({ error: "Вкажіть кількість." })
    .int("Кількість має бути цілим числом.")
    .min(1, "Кількість від 1.")
    .max(MAX_LEGACY_COUNT, `Кількість не більша за ${MAX_LEGACY_COUNT}.`),
  sinceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Вкажіть дату, з якої борг.")
    .nullable()
    .optional(),
  note: z.string().trim().max(200, "Примітка до 200 символів.").nullable().optional(),
});

export type AddLegacyDebtInput = {
  clientId: string;
  boxTypeId: string;
  count: number;
  sinceDate?: string | null;
  note?: string | null;
};

/** «Додати борг за таблицею» (D114): бокси без наклейок, які числяться за клієнтом. */
export async function addLegacyDebt(
  db: AnyPgDatabase,
  actor: AppUser,
  input: AddLegacyDebtInput,
): Promise<{ id: string }> {
  assertCanManageLegacy(actor);
  const data = parseInput(legacySchema, input);
  if (data.sinceDate && Number.isNaN(Date.parse(data.sinceDate))) {
    throw new ValidationError("Вкажіть дату, з якої борг.");
  }
  return withActor(db, actor.id, async (tx) => {
    const [client] = await tx
      .select({ id: clients.id, deletedAt: clients.deletedAt })
      .from(clients)
      .where(eq(clients.id, data.clientId));
    if (!client || client.deletedAt) throw new ValidationError("Клієнта не знайдено.");
    const [type] = await tx
      .select({ id: boxTypes.id })
      .from(boxTypes)
      .where(eq(boxTypes.id, data.boxTypeId));
    if (!type) throw new ValidationError("Тип бокса не знайдено.");
    const [created] = await tx
      .insert(boxDebtsLegacy)
      .values({
        clientId: data.clientId,
        boxTypeId: data.boxTypeId,
        count: data.count,
        sinceDate: data.sinceDate ?? null,
        sourceRow: data.note || null,
      })
      .returning({ id: boxDebtsLegacy.id });
    return { id: created!.id };
  });
}

/**
 * «Закрити N шт.»: клієнт повернув бокси без наклейки. Не можна закрити більше, ніж лишилось.
 * Рядок не видаляємо: закриті бокси лишаються в історії (журнал змін).
 */
export async function resolveLegacyDebt(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { id: string; count: number },
): Promise<{ openCount: number }> {
  assertCanManageLegacy(actor);
  const id = parseInput(z.string().uuid(), input.id);
  const count = parseInput(
    z
      .number({ error: "Вкажіть, скільки закрити." })
      .int("Кількість має бути цілим числом.")
      .min(1, "Кількість від 1."),
    input.count,
  );
  return withActor(db, actor.id, async (tx) => {
    const [row] = await tx.select().from(boxDebtsLegacy).where(eq(boxDebtsLegacy.id, id));
    if (!row) throw new ValidationError("Борг не знайдено.");
    const open = row.count - row.resolvedCount;
    if (count > open) throw new ValidationError(`Можна закрити не більше ${open}.`);
    await tx
      .update(boxDebtsLegacy)
      .set({ resolvedCount: row.resolvedCount + count })
      .where(eq(boxDebtsLegacy.id, id));
    return { openCount: open - count };
  });
}

// ---------------------------------------------------------------------------------------------
// Склад
// ---------------------------------------------------------------------------------------------

export type BoxStockRow = {
  locationId: string;
  locationName: string;
  boxTypeId: string;
  boxTypeName: string;
  inStock: number;
  atClient: number;
  sold: number;
  lost: number;
};

type RawStock = {
  location_id: string;
  location_name: string;
  box_type_id: string;
  box_type_name: string;
  in_stock: number;
  at_client: number;
  sold: number;
  lost: number;
};

/**
 * Склад (ТЗ 4.4): скільки боксів у кожному статусі по локації й типу. Старший локації бачить лише
 * свою локацію, власник усі або ту, що вибрана в шапці.
 */
export async function listBoxStock(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { locationId?: string } = {},
): Promise<BoxStockRow[]> {
  requirePermission(actor, "box_debts_stock", "read", { anyLocation: true });
  const own = locationScope(actor);
  if (actor.role === "location_lead" && !own) return [];
  if (actor.role === "production" && !own) return [];
  const locationId = own ?? options.locationId ?? null;
  const parsed = locationId ? parseInput(z.string().uuid(), locationId) : null;
  const result = await db.execute(sql`
    select s.location_id, l.name as location_name, s.box_type_id, t.name as box_type_name,
           s.in_stock, s.at_client, s.sold, s.lost
      from box_stock s
      join locations l on l.id = s.location_id
      join box_types t on t.id = s.box_type_id
     where true ${parsed ? sql`and s.location_id = ${parsed}` : sql``}
     order by l.name asc, t.sort asc
  `);
  return rowsOf<RawStock>(result).map((row) => ({
    locationId: row.location_id,
    locationName: row.location_name,
    boxTypeId: row.box_type_id,
    boxTypeName: row.box_type_name,
    inStock: Number(row.in_stock),
    atClient: Number(row.at_client),
    sold: Number(row.sold),
    lost: Number(row.lost),
  }));
}

/** Локації для вибору (куди перемістити бокс). */
export async function listLocationOptions(
  db: AnyPgDatabase,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .orderBy(asc(locations.name));
}

// ---------------------------------------------------------------------------------------------
// Бокси клієнта (вкладка на картці)
// ---------------------------------------------------------------------------------------------

export type ClientBoxItem = {
  code: string;
  boxTypeName: string;
  orderId: string | null;
  issuedAt: string | null;
  days: number | null;
};

/** Бокси, що зараз у клієнта, найдавніші першими. */
export async function listClientBoxes(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  now: Date = new Date(),
): Promise<ClientBoxItem[]> {
  assertCanSeeDebts(actor);
  const id = parseInput(z.string().uuid(), clientId);
  const rows = await db
    .select({
      code: boxes.code,
      boxTypeName: boxTypes.name,
      orderId: boxes.currentOrderId,
      issuedAt: boxes.issuedAt,
    })
    .from(boxes)
    .innerJoin(boxTypes, eq(boxTypes.id, boxes.boxTypeId))
    .where(and(eq(boxes.currentClientId, id), eq(boxes.status, "at_client")))
    .orderBy(asc(boxes.issuedAt), desc(boxes.code));
  return rows.map((row) => ({
    code: row.code,
    boxTypeName: row.boxTypeName,
    orderId: row.orderId,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    days: row.issuedAt ? daysAtClient(row.issuedAt, now) : null,
  }));
}
