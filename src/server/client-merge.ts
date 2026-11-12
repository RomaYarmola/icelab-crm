import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientAddresses, clientContacts, clientPrices, clients } from "@/db/schema";
import { rowsOf } from "@/db/rows";
import type { AnyPgDatabase } from "@/db/types";
import { addDays, formatIsoDate, todayIso } from "@/utils/isoDate";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission, requireRole } from "./guards";

/**
 * Об'єднання дублів (D46). Лише власник. Контакти, адреси, ціни й усе, що посилається на клієнта
 * (замовлення тепер, бокси потім), переходить до головного; дубль ховається з посиланням на
 * головного. Відкату немає, зміни лишаються в журналі змін.
 *
 * Таблиці, що посилаються на клієнта, знаходимо за зовнішніми ключами в самій базі: так нова
 * таблиця з `client_id` (наприклад, бокси в B9) переноситься сама, а тест це перевіряє.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Таблиці, які об'єднання переносить окремою логікою (прапорці «основний», «за замовчуванням», ціни). */
const SPECIAL_TABLES = new Set(["client_contacts", "client_addresses", "client_prices", "clients"]);

type Executor = AnyPgDatabase;

/** Стовпці інших таблиць, що посилаються на `clients.id`, окрім тих, що переносимо окремо. */
export async function findClientReferences(
  db: Executor,
): Promise<{ table: string; column: string }[]> {
  const result = await db.execute(sql`
    select cl.relname as table_name, a.attname as column_name
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.clients'::regclass
      and array_length(c.conkey, 1) = 1
    order by cl.relname, a.attname`);
  return rowsOf<{ table_name: string; column_name: string }>(result)
    .filter((row) => !SPECIAL_TABLES.has(row.table_name))
    .map((row) => ({ table: row.table_name, column: row.column_name }));
}

export type MergePreview = {
  main: { id: string; code: string; name: string };
  duplicate: { id: string; code: string; name: string };
  /** Скільки переходить до головного клієнта. */
  moves: {
    contacts: number;
    addresses: number;
    /** Типи льоду, ціни яких переходять (в головного їх ще немає). */
    priceTypes: number;
    /** Типи льоду, де в головного вже є ціна: ціни дубля лишаються в дубля. */
    priceTypesKept: number;
    /** Інші записи (замовлення тощо) за назвою таблиці. */
    references: Record<string, number>;
  };
};

type LoadedClient = typeof clients.$inferSelect;

async function loadPair(db: Executor, mainId: string, duplicateId: string) {
  if (mainId === duplicateId) {
    throw new ValidationError("Оберіть двох різних клієнтів.");
  }
  const rows = await db
    .select()
    .from(clients)
    .where(inArray(clients.id, [mainId, duplicateId]))
    .for("update");
  const main = rows.find((row) => row.id === mainId);
  const duplicate = rows.find((row) => row.id === duplicateId);
  if (!main || !duplicate) throw new ValidationError("Клієнта не знайдено.");
  if (main.isPlaceholder || duplicate.isPlaceholder) {
    throw new ValidationError("Службового клієнта об'єднувати не можна.");
  }
  if (main.deletedAt) throw new ValidationError("Головного клієнта видалено.");
  if (duplicate.deletedAt) throw new ValidationError("Клієнта-дубль уже видалено або об'єднано.");
  return { main, duplicate };
}

const priceKey = sql`coalesce(ice_type_id, ${ZERO_UUID}::uuid)`;

async function countReferences(db: Executor, duplicateId: string) {
  const references: Record<string, number> = {};
  for (const { table, column } of await findClientReferences(db)) {
    const result = await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${duplicateId}`,
    );
    const n = rowsOf<{ n: number }>(result)[0]?.n ?? 0;
    references[table] = (references[table] ?? 0) + n;
  }
  return references;
}

/** Що перейде до головного клієнта: показуємо перед підтвердженням. Лише власник. */
export async function previewMerge(
  db: Executor,
  actor: AppUser,
  mainId: string,
  duplicateId: string,
): Promise<MergePreview> {
  requirePermission(actor, "clients", "write");
  requireRole(actor, "owner");
  const { main, duplicate } = await loadPair(
    db,
    parseInput(uuid, mainId),
    parseInput(uuid, duplicateId),
  );

  const count = async (table: typeof clientContacts | typeof clientAddresses, id: string) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.clientId, id));
    return row?.n ?? 0;
  };

  const priceKeys = async (clientId: string) =>
    rowsOf<{ key: string }>(
      await db.execute(
        sql`select distinct ${priceKey} as key from client_prices where client_id = ${clientId}`,
      ),
    ).map((row) => row.key);
  const mainKeys = new Set(await priceKeys(main.id));
  const keys = await priceKeys(duplicate.id);

  return {
    main: { id: main.id, code: main.code, name: main.name },
    duplicate: { id: duplicate.id, code: duplicate.code, name: duplicate.name },
    moves: {
      contacts: await count(clientContacts, duplicate.id),
      addresses: await count(clientAddresses, duplicate.id),
      priceTypes: keys.filter((key) => !mainKeys.has(key)).length,
      priceTypesKept: keys.filter((key) => mainKeys.has(key)).length,
      references: await countReferences(db, duplicate.id),
    },
  };
}

/** Поля картки, які беремо з дубля, якщо в головного вони порожні. */
const FILL_FIELDS = [
  "legalType",
  "edrpou",
  "iceTypeId",
  "applicationId",
  "statusId",
  "managerId",
  "sourceId",
  "defaultBoxTypeId",
  "markupPercentOverride",
  "inactiveDaysThreshold",
] as const satisfies readonly (keyof LoadedClient)[];

/**
 * Зводить дубль у головного клієнта (D46). Контакти й адреси переходять (основний контакт і адреса
 * за замовчуванням лишаються головного, якщо вони в нього є), ціни переходять за типами льоду,
 * яких в головного ще немає, решта цін лишається на прихованому дублі закритою. Усе, що посилається
 * на клієнта (замовлення), переходить до головного. У примітку головного додається рядок про
 * об'єднання, порожні поля картки заповнюються з дубля. Повертає той самий підсумок, що й
 * `previewMerge`.
 */
export async function mergeClients(
  db: Executor,
  actor: AppUser,
  mainId: string,
  duplicateId: string,
): Promise<MergePreview> {
  requirePermission(actor, "clients", "write");
  requireRole(actor, "owner");
  const mainIdParsed = parseInput(uuid, mainId);
  const duplicateIdParsed = parseInput(uuid, duplicateId);

  const summary = await previewMerge(db, actor, mainIdParsed, duplicateIdParsed);
  const references = await findClientReferences(db);
  const today = todayIso();

  await withActor(db, actor.id, async (tx) => {
    const { main, duplicate } = await loadPair(tx, mainIdParsed, duplicateIdParsed);

    // Контакти: основний лишається головного, якщо він у нього є.
    const [mainPrimary] = await tx
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, main.id), eq(clientContacts.isPrimary, true)))
      .limit(1);
    await tx
      .update(clientContacts)
      .set({ clientId: main.id, ...(mainPrimary ? { isPrimary: false } : {}) })
      .where(eq(clientContacts.clientId, duplicate.id));

    // Адреси: адреса за замовчуванням лишається головного (одна на клієнта, частковий унікальний індекс).
    const [mainDefault] = await tx
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(and(eq(clientAddresses.clientId, main.id), eq(clientAddresses.isDefault, true)))
      .limit(1);
    await tx
      .update(clientAddresses)
      .set({ clientId: main.id, ...(mainDefault ? { isDefault: false } : {}) })
      .where(eq(clientAddresses.clientId, duplicate.id));

    // Ціни: переходять типи льоду, яких в головного ще немає; решту закриваємо на дублі.
    await tx.execute(sql`
      update client_prices set client_id = ${main.id}
      where client_id = ${duplicate.id}
        and ${priceKey} not in (select ${priceKey} from client_prices where client_id = ${main.id})`);
    await tx
      .update(clientPrices)
      .set({ validTo: sql`greatest(${clientPrices.validFrom}, ${addDays(today, -1)}::date)` })
      .where(and(eq(clientPrices.clientId, duplicate.id), isNull(clientPrices.validTo)));

    // Усе інше, що посилається на клієнта (замовлення та інше).
    for (const { table, column } of references) {
      await tx.execute(
        sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${main.id} where ${sql.identifier(column)} = ${duplicate.id}`,
      );
    }

    // Картка головного: порожні поля з дубля, примітка про об'єднання.
    const fill: Partial<Pick<LoadedClient, (typeof FILL_FIELDS)[number]>> = {};
    for (const field of FILL_FIELDS) {
      if (main[field] === null && duplicate[field] !== null) {
        Object.assign(fill, { [field]: duplicate[field] });
      }
    }
    const lines = [`Об'єднано з ${duplicate.code} «${duplicate.name}» (${formatIsoDate(today)}).`];
    if (duplicate.notes) lines.push(`Примітка з ${duplicate.code}: ${duplicate.notes}`);
    const notes = [main.notes, ...lines].filter(Boolean).join("\n");
    await tx
      .update(clients)
      .set({ ...fill, notes })
      .where(eq(clients.id, main.id));

    // Дубль ховаємо з посиланням на головного (код лишається зайнятим).
    await tx
      .update(clients)
      .set({ deletedAt: new Date(), mergedIntoId: main.id })
      .where(eq(clients.id, duplicate.id));
  });

  return summary;
}
