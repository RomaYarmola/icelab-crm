import { and, asc, eq, inArray } from "drizzle-orm";
import { boxTypes, clientOwnBoxes, orderBoxes } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseDecimal } from "@/utils/orderMath";
import { ValidationError } from "./errors";

/**
 * Тара замовлення рядками (Роман, 20.11.2026): кілька видів боксів в одному замовленні, наприклад
 * 2 × Міні 9 л або 1 × mini і 1 × довгий. Рядок: наш тип тари або бокс клієнта (D164) і кількість.
 * Підсумок (`orders.box_type_id`, `box_count`, `client_own_box_id`) рахуємо тут і пишемо при
 * збереженні, щоб старі екрани й звіти не розійшлися з рядками.
 */

export type BoxLine = {
  boxTypeId: string | null;
  clientOwnBoxId: string | null;
  count: number;
};

/** Рядок із форми чи бота: порожні ідентифікатори можуть бути відсутні. */
export type BoxLineInput = {
  boxTypeId?: string | null;
  clientOwnBoxId?: string | null;
  count: number;
};

/** Рядок для показу й розрахунків: з назвою, місткістю, вагою порожнього й розмірами. */
export type BoxLineView = BoxLine & {
  /** Бокс клієнта (бокс з його картки чи загальний тип «Бокс клієнта»), а не наш. */
  isClient: boolean;
  /** Вид тари: бокс для льоду чи сосуд Дюара для азоту (місткість у кг льоду його не стосується). */
  kind: "ice" | "dewar";
  name: string;
  capacityKg: string | null;
  emptyWeightKg: string | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
};

/** Старі поля замовлення (один тип і кількість) як один рядок; без кількості чи типу рядків немає. */
export function legacyBoxLines(box: {
  boxTypeId: string | null;
  clientOwnBoxId: string | null;
  boxCount: number;
}): BoxLine[] {
  if (box.boxCount <= 0 || (!box.boxTypeId && !box.clientOwnBoxId)) return [];
  return [{ boxTypeId: box.boxTypeId, clientOwnBoxId: box.clientOwnBoxId, count: box.boxCount }];
}

/** Підсумок для колонок замовлення: кількість усіх боксів, перший тип і перший бокс клієнта. */
export function boxSummary(lines: BoxLine[]) {
  return {
    boxCount: lines.reduce((sum, line) => sum + line.count, 0),
    boxTypeId: lines.find((line) => line.boxTypeId)?.boxTypeId ?? null,
    clientOwnBoxId: lines.find((line) => line.clientOwnBoxId)?.clientOwnBoxId ?? null,
  };
}

/**
 * Перевіряє й прибирає зайве: кількість ціла й додатна, тип тари існує, бокс належить клієнтові.
 * Однакові рядки зливаємо. `dropClientBoxes`: для старих полів із не клієнтською тарою боксів
 * клієнта в рядках не лишаємо (у рядках з форми кожен рядок сам каже, чий він).
 */
export async function normalizeBoxLines(
  db: AnyPgDatabase,
  input: { clientId: string; dropClientBoxes?: boolean; lines: BoxLineInput[] },
): Promise<BoxLine[]> {
  const merged = new Map<string, BoxLine>();
  for (const raw of input.lines) {
    if (!Number.isInteger(raw.count) || raw.count <= 0) {
      throw new ValidationError("Кількість боксів має бути цілим числом від 1.");
    }
    if (raw.count > 10_000) throw new ValidationError("Забагато боксів: перевірте число.");
    if (!raw.boxTypeId && !raw.clientOwnBoxId) {
      throw new ValidationError("Оберіть бокс для кожного рядка тари.");
    }
    if (input.dropClientBoxes && raw.clientOwnBoxId) continue;
    const key = `${raw.boxTypeId ?? ""}|${raw.clientOwnBoxId ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.count += raw.count;
    else {
      merged.set(key, {
        boxTypeId: raw.boxTypeId ?? null,
        clientOwnBoxId: raw.clientOwnBoxId ?? null,
        count: raw.count,
      });
    }
  }
  const lines = [...merged.values()];

  const typeIds = [...new Set(lines.flatMap((line) => (line.boxTypeId ? [line.boxTypeId] : [])))];
  if (typeIds.length > 0) {
    const found = await db
      .select({ id: boxTypes.id })
      .from(boxTypes)
      .where(inArray(boxTypes.id, typeIds));
    if (found.length !== typeIds.length) throw new ValidationError("Тип тари не знайдено.");
  }
  const ownIds = [
    ...new Set(lines.flatMap((line) => (line.clientOwnBoxId ? [line.clientOwnBoxId] : []))),
  ];
  if (ownIds.length > 0) {
    const found = await db
      .select({ id: clientOwnBoxes.id, clientId: clientOwnBoxes.clientId })
      .from(clientOwnBoxes)
      .where(inArray(clientOwnBoxes.id, ownIds));
    if (found.length !== ownIds.length || found.some((row) => row.clientId !== input.clientId)) {
      throw new ValidationError("Бокс не належить цьому клієнту.");
    }
  }
  return lines;
}

/** Замінює рядки тари замовлення (всередині транзакції збереження). */
export async function saveOrderBoxLines(
  tx: AnyPgDatabase,
  orderId: string,
  lines: BoxLine[],
): Promise<void> {
  await tx.delete(orderBoxes).where(eq(orderBoxes.orderId, orderId));
  if (lines.length === 0) return;
  await tx.insert(orderBoxes).values(
    lines.map((line, index) => ({
      orderId,
      boxTypeId: line.boxTypeId,
      clientOwnBoxId: line.clientOwnBoxId,
      count: line.count,
      sort: index,
    })),
  );
}

/** Рядки тари замовлень з назвами й характеристиками боксів. Ключ: ідентифікатор замовлення. */
export async function loadBoxLineViews(
  db: AnyPgDatabase,
  orderIds: string[],
): Promise<Map<string, BoxLineView[]>> {
  const result = new Map<string, BoxLineView[]>();
  if (orderIds.length === 0) return result;
  const rows = await db
    .select({
      orderId: orderBoxes.orderId,
      boxTypeId: orderBoxes.boxTypeId,
      clientOwnBoxId: orderBoxes.clientOwnBoxId,
      count: orderBoxes.count,
      typeName: boxTypes.name,
      typeIsClient: boxTypes.isClientOwned,
      typeKind: boxTypes.kind,
      ownKind: clientOwnBoxes.kind,
      typeCapacity: boxTypes.capacityKg,
      typeEmpty: boxTypes.emptyWeightKg,
      typeHeight: boxTypes.heightMm,
      typeWidth: boxTypes.widthMm,
      typeLength: boxTypes.lengthMm,
      ownName: clientOwnBoxes.name,
      ownCapacity: clientOwnBoxes.capacityKg,
      ownEmpty: clientOwnBoxes.emptyWeightKg,
      ownHeight: clientOwnBoxes.heightMm,
      ownWidth: clientOwnBoxes.widthMm,
      ownLength: clientOwnBoxes.lengthMm,
    })
    .from(orderBoxes)
    .leftJoin(boxTypes, eq(boxTypes.id, orderBoxes.boxTypeId))
    .leftJoin(clientOwnBoxes, eq(clientOwnBoxes.id, orderBoxes.clientOwnBoxId))
    .where(inArray(orderBoxes.orderId, orderIds))
    .orderBy(asc(orderBoxes.orderId), asc(orderBoxes.sort));
  for (const row of rows) {
    const own = row.clientOwnBoxId !== null;
    // Бокс клієнта сильніший за тип тари: кожне значення з нього, коли воно там задане.
    const dims =
      row.ownHeight && row.ownWidth && row.ownLength
        ? [row.ownHeight, row.ownWidth, row.ownLength]
        : [row.typeHeight, row.typeWidth, row.typeLength];
    const view: BoxLineView = {
      boxTypeId: row.boxTypeId,
      clientOwnBoxId: row.clientOwnBoxId,
      count: row.count,
      isClient: own || row.typeIsClient === true,
      kind: (own ? row.ownKind : row.typeKind) === "dewar" ? "dewar" : "ice",
      name: (own ? row.ownName : row.typeName) ?? row.typeName ?? "Тара",
      capacityKg: (own ? row.ownCapacity : null) ?? row.typeCapacity,
      emptyWeightKg: (own ? row.ownEmpty : null) ?? row.typeEmpty,
      heightMm: dims[0] ?? null,
      widthMm: dims[1] ?? null,
      lengthMm: dims[2] ?? null,
    };
    const list = result.get(row.orderId) ?? [];
    list.push(view);
    result.set(row.orderId, list);
  }
  return result;
}

/**
 * Скільки кг вміщають усі бокси замовлення (D165): сума «кількість × місткість» за рядками.
 * `null`, якщо боксів немає чи в якогось рядка місткість не задана (тоді обмеження немає).
 */
export async function linesCapacity(db: AnyPgDatabase, lines: BoxLine[]): Promise<number | null> {
  if (lines.length === 0) return null;
  let total = 0;
  let iceLines = 0;
  for (const line of lines) {
    let capacity: string | null = null;
    let kind = "ice";
    if (line.clientOwnBoxId) {
      const [row] = await db
        .select({ capacityKg: clientOwnBoxes.capacityKg, kind: clientOwnBoxes.kind })
        .from(clientOwnBoxes)
        .where(eq(clientOwnBoxes.id, line.clientOwnBoxId));
      capacity = row?.capacityKg ?? null;
      kind = row?.kind ?? "ice";
    }
    if (capacity === null && line.boxTypeId) {
      const [row] = await db
        .select({ capacityKg: boxTypes.capacityKg, kind: boxTypes.kind })
        .from(boxTypes)
        .where(eq(boxTypes.id, line.boxTypeId));
      capacity = row?.capacityKg ?? null;
      if (!line.clientOwnBoxId) kind = row?.kind ?? "ice";
    }
    // Сосуди Дюара для азоту не вміщають лід: у місткість для «виготовити» не входять.
    if (kind === "dewar") continue;
    iceLines += 1;
    const perBox = capacity === null ? 0 : parseDecimal(capacity);
    if (!(perBox > 0)) return null;
    total += perBox * line.count;
  }
  if (iceLines === 0) return null;
  return total;
}

/**
 * Скільки наших боксів треба видати під замовлення: лише наші рядки (бокси клієнта не видаємо), а
 * проданої тари це не стосується. Без рядків (старі замовлення) за підсумком, як було.
 */
export function ourBoxesNeeded(
  ownership: "ours" | "client" | "sold",
  boxCount: number,
  lines: { count: number; isClient: boolean }[],
): number {
  if (ownership === "sold") return 0;
  if (lines.length === 0) return ownership === "ours" ? boxCount : 0;
  return lines.filter((line) => !line.isClient).reduce((sum, line) => sum + line.count, 0);
}

/** Рядки тари одним текстом: «2 × Міні 9 л, 1 × Довгий 46 л». Порожній рядок, якщо тари немає. */
export function describeBoxLines(lines: { name: string; count: number }[]): string {
  return lines.map((line) => `${line.count} × ${line.name}`).join(", ");
}

/**
 * Чия тара замовлення за рядками: усі рядки клієнта дають «клієнта», будь-який наш рядок «наша».
 * Без рядків лишаємо `fallback` (старе значення чи «наша»).
 */
export async function deriveBoxOwnership(
  db: AnyPgDatabase,
  lines: BoxLine[],
  fallback: "ours" | "client" | "sold",
): Promise<"ours" | "client" | "sold"> {
  if (lines.length === 0) return fallback;
  const typeIds = [...new Set(lines.flatMap((line) => (line.boxTypeId ? [line.boxTypeId] : [])))];
  const clientTypes = new Set<string>();
  if (typeIds.length > 0) {
    const rows = await db
      .select({ id: boxTypes.id })
      .from(boxTypes)
      .where(and(inArray(boxTypes.id, typeIds), eq(boxTypes.isClientOwned, true)));
    for (const row of rows) clientTypes.add(row.id);
  }
  const allClient = lines.every(
    (line) => line.clientOwnBoxId !== null || (line.boxTypeId && clientTypes.has(line.boxTypeId)),
  );
  if (allClient) return "client";
  return fallback === "sold" ? "sold" : "ours";
}

/** Рядки замовлення з бази без назв (для перерахунків при зміні). */
export async function loadOrderBoxLines(db: AnyPgDatabase, orderId: string): Promise<BoxLine[]> {
  const rows = await db
    .select({
      boxTypeId: orderBoxes.boxTypeId,
      clientOwnBoxId: orderBoxes.clientOwnBoxId,
      count: orderBoxes.count,
    })
    .from(orderBoxes)
    .where(eq(orderBoxes.orderId, orderId))
    .orderBy(asc(orderBoxes.sort));
  return rows;
}
