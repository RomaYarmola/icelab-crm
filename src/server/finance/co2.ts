import { and, asc, eq, gte, isNull, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import {
  co2Adjustments,
  co2Norms,
  co2Receipts,
  iceWriteoffs,
  locations,
  orders,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { kopecksToUah, toKopecks } from "@/server/cash-rules";
import { parseInput, ValidationError } from "@/server/errors";
import { type AppUser, requirePermission } from "@/server/guards";
import { isIsoDate, todayIso } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import { buildCo2Ledger, type Co2Ledger, normOn } from "./co2-rules";

/**
 * Сировина CO2 (B15, D232, D233, D240): приходи, норма, виправлення залишку й списаний лід по
 * містах. Бачить і змінює лише власник. Залишок і вартість не зберігаються: рахуються щоразу.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const MAX_VALUE = 1_000_000;

const dateField = z.string().refine(isIsoDate, "Вкажіть дату.");

const amountField = (message: string, digits: number) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === "number" ? value : parseDecimal(value)))
    .pipe(z.number(message).min(0, message).max(MAX_VALUE, "Надто велике число: перевірте його."))
    .transform((value) => value.toFixed(digits));

const positiveField = (message: string, digits: number) =>
  amountField(message, digits).refine((value) => Number(value) > 0, message);

const noteField = z.string().trim().max(500, "Примітка надто довга.").nullable().optional();

const receiptSchema = z.object({
  locationId: uuid,
  receivedOn: dateField,
  kg: positiveField("Вкажіть кількість CO2 в кг, більше нуля.", 3),
  pricePerKg: positiveField("Вкажіть ціну за кг, більше нуля.", 2),
  note: noteField,
});

const normSchema = z.object({
  locationId: uuid,
  validFrom: dateField,
  norm: positiveField("Вкажіть норму: кг CO2 на 1 кг льоду.", 3).refine(
    (value) => Number(value) <= 100,
    "Норма не може бути більшою за 100.",
  ),
});

const writeoffSchema = z.object({
  locationId: uuid,
  writtenOffOn: dateField,
  kg: positiveField("Вкажіть кількість льоду в кг, більше нуля.", 3),
  note: noteField,
});

const stockSchema = z.object({
  locationId: uuid,
  actualKg: amountField("Вкажіть фактичний залишок CO2 в кг (нуль або більше).", 3),
  note: z
    .string()
    .trim()
    .min(1, "Напишіть, чому виправляєте залишок.")
    .max(500, "Примітка надто довга."),
});

export type Co2EntryKind = "receipt" | "norm" | "adjustment" | "writeoff";

function assertCanWrite(actor: AppUser) {
  requirePermission(actor, "finance", "write");
}

function assertNotFuture(date: string, today: string) {
  if (date > today) throw new ValidationError("Дата не може бути в майбутньому.");
}

async function assertLocation(db: AnyPgDatabase, locationId: string) {
  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, locationId));
  if (!row) throw new ValidationError("Локацію не знайдено.");
}

async function loadEntries(db: AnyPgDatabase, locationId: string) {
  const [receipts, norms, adjustments, writeoffs] = await Promise.all([
    db
      .select()
      .from(co2Receipts)
      .where(eq(co2Receipts.locationId, locationId))
      .orderBy(asc(co2Receipts.receivedOn), asc(co2Receipts.createdAt)),
    db
      .select()
      .from(co2Norms)
      .where(eq(co2Norms.locationId, locationId))
      .orderBy(asc(co2Norms.validFrom)),
    db
      .select()
      .from(co2Adjustments)
      .where(eq(co2Adjustments.locationId, locationId))
      .orderBy(asc(co2Adjustments.adjustedOn), asc(co2Adjustments.createdAt)),
    db
      .select()
      .from(iceWriteoffs)
      .where(eq(iceWriteoffs.locationId, locationId))
      .orderBy(asc(iceWriteoffs.writtenOffOn), asc(iceWriteoffs.createdAt)),
  ]);
  return { receipts, norms, adjustments, writeoffs };
}

const grams = (kg: string) => Math.round(Number(kg) * 1000);

/**
 * Облік CO2 міста станом на дату. Лід беремо з «виготовити» замовлень, крім чернеток, скасованих і
 * видалених (D218, D233). Без перевірки прав: викликають лише серверні функції фінрезультату.
 */
async function ledgerOf(
  db: AnyPgDatabase,
  locationId: string,
  entries: Awaited<ReturnType<typeof loadEntries>>,
  asOf: string,
): Promise<Co2Ledger> {
  const startedOn = entries.receipts[0]?.receivedOn;
  const produced =
    startedOn === undefined
      ? []
      : await db
          .select({ date: orders.orderDate, kg: sql<string>`sum(${orders.kgToProduce})` })
          .from(orders)
          .where(
            and(
              eq(orders.locationId, locationId),
              isNull(orders.deletedAt),
              notInArray(orders.status, ["draft", "cancelled"]),
              gte(orders.orderDate, startedOn),
              lte(orders.orderDate, asOf),
            ),
          )
          .groupBy(orders.orderDate);
  return buildCo2Ledger({
    asOf,
    receipts: entries.receipts.map((r) => ({
      date: r.receivedOn,
      grams: grams(r.kg),
      kopecksPerKg: toKopecks(r.pricePerKg),
    })),
    norms: entries.norms.map((n) => ({ validFrom: n.validFrom, normMilli: grams(n.norm) })),
    adjustments: entries.adjustments.map((a) => ({ date: a.adjustedOn, grams: grams(a.kg) })),
    uses: [
      ...produced.map((row) => ({
        date: row.date,
        iceGrams: grams(row.kg),
        source: "orders" as const,
      })),
      ...entries.writeoffs.map((row) => ({
        date: row.writtenOffOn,
        iceGrams: grams(row.kg),
        source: "writeoff" as const,
      })),
    ],
  });
}

export type Co2UseView = { iceKg: number; co2Kg: number; cost: string };

export type Co2PageData = {
  locations: { id: string; code: string; name: string }[];
  location: { id: string; code: string; name: string };
  today: string;
  startedOn: string | null;
  stockKg: number;
  stockValue: string;
  /** Чинна сьогодні норма, кг CO2 на 1 кг льоду. */
  norm: number | null;
  shortageKg: number;
  missingNorm: boolean;
  /** Місяці з витратою CO2, новіші першими. */
  months: { month: string; orders: Co2UseView; writeoffs: Co2UseView; shortageKg: number }[];
  receipts: { id: string; date: string; kg: number; pricePerKg: string; note: string | null }[];
  adjustments: { id: string; date: string; kg: number; note: string }[];
  writeoffs: { id: string; date: string; kg: number; note: string | null }[];
  norms: { id: string; validFrom: string; norm: number }[];
};

const useView = (use: { iceGrams: number; co2Grams: number; costKopecks: number }) => ({
  iceKg: use.iceGrams / 1000,
  co2Kg: use.co2Grams / 1000,
  cost: kopecksToUah(use.costKopecks),
});

/** Дані екрана сировини: місто за кодом (`kyiv`, `lviv`) або перше за назвою. Списки: новіші першими. */
export async function getCo2Page(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { location?: string; today?: string } = {},
): Promise<Co2PageData> {
  requirePermission(actor, "finance", "read");
  const today = query.today ?? todayIso();
  const list = await db
    .select({ id: locations.id, code: locations.code, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));
  const location = list.find((item) => item.code === query.location) ?? list[0];
  if (!location) throw new ValidationError("Немає жодної локації.");
  const entries = await loadEntries(db, location.id);
  const ledger = await ledgerOf(db, location.id, entries, today);
  const normMilli = normOn(
    entries.norms.map((n) => ({ validFrom: n.validFrom, normMilli: grams(n.norm) })),
    today,
  );
  return {
    locations: list,
    location,
    today,
    startedOn: ledger.startedOn,
    stockKg: ledger.stockGrams / 1000,
    stockValue: kopecksToUah(ledger.stockKopecks),
    norm: normMilli === null ? null : normMilli / 1000,
    shortageKg: ledger.shortageGrams / 1000,
    missingNorm: ledger.missingNorm,
    months: ledger.months
      .map((m) => ({
        month: m.month,
        orders: useView(m.orders),
        writeoffs: useView(m.writeoffs),
        shortageKg: m.shortageGrams / 1000,
      }))
      .reverse(),
    receipts: entries.receipts
      .map((r) => ({
        id: r.id,
        date: r.receivedOn,
        kg: Number(r.kg),
        pricePerKg: r.pricePerKg,
        note: r.note,
      }))
      .reverse(),
    adjustments: entries.adjustments
      .map((a) => ({ id: a.id, date: a.adjustedOn, kg: Number(a.kg), note: a.note }))
      .reverse(),
    writeoffs: entries.writeoffs
      .map((r) => ({ id: r.id, date: r.writtenOffOn, kg: Number(r.kg), note: r.note }))
      .reverse(),
    norms: entries.norms
      .map((n) => ({ id: n.id, validFrom: n.validFrom, norm: Number(n.norm) }))
      .reverse(),
  };
}

export async function addCo2Receipt(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof receiptSchema>,
  today: string = todayIso(),
): Promise<void> {
  assertCanWrite(actor);
  const data = parseInput(receiptSchema, input);
  assertNotFuture(data.receivedOn, today);
  await assertLocation(db, data.locationId);
  await withActor(db, actor.id, async (tx) => {
    await tx.insert(co2Receipts).values({ ...data, note: data.note || null });
  });
}

/** Норма з дати (можна майбутньої чи минулої); повторний запис на ту саму дату замінює її. */
export async function setCo2Norm(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof normSchema>,
): Promise<void> {
  assertCanWrite(actor);
  const data = parseInput(normSchema, input);
  await assertLocation(db, data.locationId);
  await withActor(db, actor.id, async (tx) => {
    await tx
      .insert(co2Norms)
      .values(data)
      .onConflictDoUpdate({
        target: [co2Norms.locationId, co2Norms.validFrom],
        set: { norm: data.norm },
      });
  });
}

export async function addIceWriteoff(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof writeoffSchema>,
  today: string = todayIso(),
): Promise<void> {
  assertCanWrite(actor);
  const data = parseInput(writeoffSchema, input);
  assertNotFuture(data.writtenOffOn, today);
  await assertLocation(db, data.locationId);
  await withActor(db, actor.id, async (tx) => {
    await tx.insert(iceWriteoffs).values({ ...data, note: data.note || null });
  });
}

/**
 * Виправлення залишку (D233): власник пише, скільки CO2 є насправді сьогодні, а ми записуємо
 * різницю з порахованим залишком і примітку.
 */
export async function setCo2Stock(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof stockSchema>,
  today: string = todayIso(),
): Promise<void> {
  assertCanWrite(actor);
  const data = parseInput(stockSchema, input);
  await assertLocation(db, data.locationId);
  await withActor(db, actor.id, async (tx) => {
    // Блокуємо рядок міста, щоб два виправлення поспіль не порахували ту саму різницю двічі.
    await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, data.locationId))
      .for("update");
    const entries = await loadEntries(tx, data.locationId);
    const ledger = await ledgerOf(tx, data.locationId, entries, today);
    if (ledger.startedOn === null) {
      throw new ValidationError("Спершу додайте прихід CO2: залишок рахується з нього.");
    }
    const delta = grams(data.actualKg) - ledger.stockGrams;
    if (delta === 0) throw new ValidationError("Залишок уже такий: виправляти нічого.");
    await tx.insert(co2Adjustments).values({
      locationId: data.locationId,
      adjustedOn: today,
      kg: (delta / 1000).toFixed(3),
      note: data.note,
    });
  });
}

const ENTRY_TABLES = {
  receipt: co2Receipts,
  norm: co2Norms,
  adjustment: co2Adjustments,
  writeoff: iceWriteoffs,
} as const;

/** Видаляє помилковий запис; журнал змін зберігає, що в ньому було. */
export async function deleteCo2Entry(
  db: AnyPgDatabase,
  actor: AppUser,
  kind: Co2EntryKind,
  id: string,
): Promise<void> {
  assertCanWrite(actor);
  const table =
    ENTRY_TABLES[parseInput(z.enum(["receipt", "norm", "adjustment", "writeoff"]), kind)];
  const entryId = parseInput(uuid, id);
  await withActor(db, actor.id, async (tx) => {
    const deleted = await tx.delete(table).where(eq(table.id, entryId)).returning({ id: table.id });
    if (deleted.length === 0) throw new ValidationError("Запис уже видалено.");
  });
}
