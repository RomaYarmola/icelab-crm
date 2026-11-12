import { and, asc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { legalType } from "@/db/schema/enums";
import {
  boxTypes,
  clientAddresses,
  clientApplications,
  clientContacts,
  clients,
  clientStatuses,
  iceTypes,
  orderSources,
  profiles,
  regions,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { isRegionPrefix, normalizeClientCode } from "@/utils/clientCode";
import { normalizePhone, phoneSearchDigits } from "@/utils/phone";
import { nextClientCode, peekNextClientCode, retryOnCodeConflict } from "./client-codes";
import { type ClientCardView, type ClientListItem, toClientCardView } from "./client-views";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission, requireRole } from "./guards";
import { listClientPrices } from "./prices";

/**
 * Клієнти (B4): список із пошуком, картка, створення з кодом, зміна, видалення й відновлення.
 * Контакти й адреси: `client-details.ts`, ціни: `prices.ts`, об'єднання дублів: `client-merge.ts`.
 * Клієнти спільні для Києва і Львова, тому локацією записи не обмежуємо (ТЗ: «Клієнти», без «св.»).
 */

export const CLIENTS_PAGE_SIZE = 30;
const SEARCH_MAX_LENGTH = 100;
const SIMILARITY_THRESHOLD = 0.6;
/** Поріг схожості слова запиту зі словом у назві: одна помилка в шестибуквеному слові дає 0,4. */
const WORD_SIMILARITY_THRESHOLD = 0.39;
const SIMILAR_LIMIT = 5;

const uuid = z.uuid("Некоректний ідентифікатор.");
const optionalUuid = uuid.nullable().optional();

/** Екранує `%`, `_` і `\` у введеному тексті, щоб вони не працювали як символи шаблону LIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ---------------------------------------------------------------------------------------------
// Список і пошук
// ---------------------------------------------------------------------------------------------

export type ClientListQuery = {
  /** Код, назва, телефон (частина цифр) або ім'я контакту. */
  search?: string;
  statusId?: string;
  managerId?: string;
  applicationId?: string;
  /** Лише власник: показати й видалених клієнтів. */
  includeDeleted?: boolean;
  offset?: number;
  limit?: number;
};

export type ClientListPage = { items: ClientListItem[]; hasMore: boolean };

/** Умова пошуку за кодом, назвою (з помилками), телефоном і ім'ям контакту (D47). */
function searchCondition(raw: string): SQL | undefined {
  const query = raw.trim().slice(0, SEARCH_MAX_LENGTH);
  if (query === "") return undefined;

  const likeText = `%${escapeLike(query)}%`;
  const parts: SQL[] = [
    sql`${clients.name} ilike ${likeText}`,
    // Подібна назва: терпить помилку в літері (триграми, розширення pg_trgm). `%` порівнює із
    // усією назвою, `word_similarity` знаходить схоже слово всередині довгої назви («Вогнік» у
    // «Кафе Вогник»). Друга умова без індексу, але клієнтів сотні, а не мільйони.
    sql`${clients.name} % ${query}`,
    sql`word_similarity(${query}, ${clients.name}) >= ${WORD_SIMILARITY_THRESHOLD}`,
    sql`exists (select 1 from client_contacts cc where cc.client_id = ${clients.id} and cc.name ilike ${likeText})`,
  ];

  const code = normalizeClientCode(query);
  if (/^[А-ЯІЇЄҐ0-9]+$/.test(code)) {
    parts.push(sql`${clients.code} like ${`${escapeLike(code)}%`}`);
    // Лише цифри: той самий номер у будь-якій області («15» знаходить АА15 і ВС15).
    if (/^[0-9]{1,6}$/.test(code)) {
      parts.push(sql`${clients.code} ~ ${`^[А-ЯІЇЄҐ]{2}${code}$`}`);
    }
  }

  const digits = phoneSearchDigits(query);
  if (digits) {
    parts.push(
      sql`exists (select 1 from client_contacts cc where cc.client_id = ${clients.id} and cc.phone like ${`%${digits}%`})`,
    );
  }
  return or(...parts);
}

/** Список клієнтів частинами (по 30). Видалених приховано; власник може їх увімкнути. */
export async function listClients(
  db: AnyPgDatabase,
  actor: AppUser,
  query: ClientListQuery = {},
): Promise<ClientListPage> {
  requirePermission(actor, "clients", "read");
  const limit = Math.min(Math.max(query.limit ?? CLIENTS_PAGE_SIZE, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions: (SQL | undefined)[] = [];
  if (!(query.includeDeleted && actor.role === "owner")) conditions.push(isNull(clients.deletedAt));
  if (query.statusId) conditions.push(eq(clients.statusId, parseInput(uuid, query.statusId)));
  if (query.managerId) conditions.push(eq(clients.managerId, parseInput(uuid, query.managerId)));
  if (query.applicationId) {
    conditions.push(eq(clients.applicationId, parseInput(uuid, query.applicationId)));
  }
  if (query.search) conditions.push(searchCondition(query.search));

  const normalizedCode = normalizeClientCode((query.search ?? "").trim());
  const rows = await db
    .select({
      id: clients.id,
      code: clients.code,
      name: clients.name,
      statusId: clients.statusId,
      statusName: clientStatuses.name,
      managerId: clients.managerId,
      managerName: profiles.fullName,
      primaryPhone: sql<string | null>`(
        select cc.phone from client_contacts cc
        where cc.client_id = ${clients.id} and cc.phone is not null
        order by cc.is_primary desc, cc.created_at asc limit 1)`,
      deletedAt: clients.deletedAt,
    })
    .from(clients)
    .leftJoin(clientStatuses, eq(clientStatuses.id, clients.statusId))
    .leftJoin(profiles, eq(profiles.id, clients.managerId))
    .where(and(...conditions))
    // Точний збіг коду першим, далі за назвою.
    .orderBy(sql`(${clients.code} = ${normalizedCode}) desc`, asc(clients.name), asc(clients.code))
    .limit(limit + 1)
    .offset(offset);

  const items = rows.slice(0, limit).map(({ deletedAt, ...item }) => ({
    ...item,
    isDeleted: deletedAt !== null,
  }));
  return { items, hasMore: rows.length > limit };
}

// ---------------------------------------------------------------------------------------------
// Картка
// ---------------------------------------------------------------------------------------------

/** Картка клієнта з контактами, адресами й (за правом) цінами. `null`, якщо клієнта немає. */
export async function getClient(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<ClientCardView | null> {
  requirePermission(actor, "clients", "read");
  const id = parseInput(uuid, clientId);

  const [row] = await db
    .select({
      client: clients,
      statusName: clientStatuses.name,
      applicationName: clientApplications.name,
      iceTypeName: iceTypes.name,
      managerName: profiles.fullName,
      sourceName: orderSources.name,
      boxTypeName: boxTypes.name,
    })
    .from(clients)
    .leftJoin(clientStatuses, eq(clientStatuses.id, clients.statusId))
    .leftJoin(clientApplications, eq(clientApplications.id, clients.applicationId))
    .leftJoin(iceTypes, eq(iceTypes.id, clients.iceTypeId))
    .leftJoin(profiles, eq(profiles.id, clients.managerId))
    .leftJoin(orderSources, eq(orderSources.id, clients.sourceId))
    .leftJoin(boxTypes, eq(boxTypes.id, clients.defaultBoxTypeId))
    .where(eq(clients.id, id))
    .limit(1);
  if (!row) return null;
  // Видалених бачить лише власник.
  if (row.client.deletedAt && actor.role !== "owner") return null;

  const [contacts, addresses, prices] = await Promise.all([
    db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id))
      .orderBy(sql`${clientContacts.isPrimary} desc`, asc(clientContacts.createdAt)),
    db
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, id))
      .orderBy(sql`${clientAddresses.isDefault} desc`, asc(clientAddresses.createdAt)),
    // Ціни запитуємо лише тим, хто має на них право (інакше listClientPrices кинув би відмову).
    actorCanSeePrices(actor) ? listClientPrices(db, actor, id) : Promise.resolve(null),
  ]);

  const { client, ...names } = row;
  return toClientCardView(client, names, contacts, addresses, actor.role, prices);
}

function actorCanSeePrices(actor: AppUser): boolean {
  try {
    requirePermission(actor, "client_prices", "read");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Створення і зміна
// ---------------------------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, "Вкажіть назву клієнта.")
  .max(200, "Назва надто довга.");
const edrpouSchema = z
  .string()
  .trim()
  .regex(/^([0-9]{8}|[0-9]{10})$/, "ЄДРПОУ складається з 8 цифр, ІПН з 10.")
  .nullable();
const notesSchema = z.string().trim().max(2000, "Примітка надто довга.").nullable();
const markupSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "string" ? Number(value.replace(",", ".")) : value))
  .pipe(
    z
      .number("Надбавка має бути числом.")
      .min(0, "Надбавка від 0 до 100.")
      .max(100, "Надбавка від 0 до 100."),
  )
  .transform((value) => value.toFixed(2))
  .nullable();
const thresholdSchema = z
  .number("Кількість днів має бути числом.")
  .int("Кількість днів має бути цілою.")
  .min(1, "Кількість днів має бути більшою за нуль.")
  .max(3650, "Кількість днів надто велика.")
  .nullable();

/** Поля, спільні для створення й зміни (усе, крім коду і області). */
const clientFields = {
  legalType: z.enum(legalType.enumValues, "Оберіть тип клієнта зі списку.").nullable(),
  edrpou: edrpouSchema,
  iceTypeId: optionalUuid,
  applicationId: optionalUuid,
  statusId: optionalUuid,
  managerId: optionalUuid,
  sourceId: optionalUuid,
  defaultBoxTypeId: optionalUuid,
  markupPercentOverride: markupSchema,
  notes: notesSchema,
  inactiveDaysThreshold: thresholdSchema,
};

const clientFieldsSchema = z.object(clientFields).partial();

const createClientSchema = clientFieldsSchema.extend({
  name: nameSchema,
  regionPrefix: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(),
});

const updateClientSchema = clientFieldsSchema.extend({ name: nameSchema.optional() });

export type CreateClientInput = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;

async function assertExists(
  db: AnyPgDatabase,
  table:
    | typeof iceTypes
    | typeof clientApplications
    | typeof clientStatuses
    | typeof orderSources
    | typeof boxTypes,
  id: string | null | undefined,
  message: string,
) {
  if (!id) return;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new ValidationError(message);
}

async function assertManager(db: AnyPgDatabase, managerId: string | null | undefined) {
  if (!managerId) return;
  const [row] = await db
    .select({ role: profiles.role, isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, managerId))
    .limit(1);
  if (!row || !row.isActive || (row.role !== "manager" && row.role !== "owner")) {
    throw new ValidationError("Менеджера не знайдено або його вимкнено.");
  }
}

/** Перевіряє посилання на довідники в полях клієнта. */
async function assertReferences(
  db: AnyPgDatabase,
  data: {
    iceTypeId?: string | null;
    applicationId?: string | null;
    statusId?: string | null;
    sourceId?: string | null;
    defaultBoxTypeId?: string | null;
    managerId?: string | null;
  },
) {
  await assertExists(db, iceTypes, data.iceTypeId, "Тип льоду не знайдено.");
  await assertExists(db, clientApplications, data.applicationId, "Застосування не знайдено.");
  await assertExists(db, clientStatuses, data.statusId, "Статус не знайдено.");
  await assertExists(db, orderSources, data.sourceId, "Джерело не знайдено.");
  await assertExists(db, boxTypes, data.defaultBoxTypeId, "Тип тари не знайдено.");
  await assertManager(db, data.managerId);
}

async function loadRegion(db: AnyPgDatabase, prefix: string | null | undefined) {
  const normalized = prefix ? normalizeClientCode(prefix) : "";
  if (normalized === "") return null;
  if (!isRegionPrefix(normalized)) throw new ValidationError("Оберіть область зі списку.");
  const [row] = await db.select().from(regions).where(eq(regions.prefix, normalized)).limit(1);
  if (!row) throw new ValidationError("Область не знайдено.");
  return row.prefix;
}

/** Телефон з форми: порожній дає `null`, нерозпізнаний помилку з підказкою. */
function parsePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined || input.trim() === "") return null;
  const phone = normalizePhone(input);
  if (!phone) {
    throw new ValidationError("Не вдалося розпізнати телефон. Вкажіть, наприклад, 050 123 45 67.");
  }
  return phone;
}

export type CreatedClient = { id: string; code: string };

/**
 * Створює клієнта з кодом за областю (D42). Менеджер вибирає область, код видається сам: номер
 * найбільший у префіксі плюс 1. Без області код з самих цифр. Телефон (якщо є) стає основним
 * контактом. Статус за замовчуванням «Активний», менеджер за замовчуванням той, хто створює.
 */
export async function createClient(
  db: AnyPgDatabase,
  actor: AppUser,
  input: CreateClientInput,
): Promise<CreatedClient> {
  requirePermission(actor, "clients", "write");
  const data = parseInput(createClientSchema, input);
  const prefix = await loadRegion(db, data.regionPrefix);
  const phone = parsePhone(data.phone);
  await assertReferences(db, data);

  let statusId = data.statusId ?? null;
  if (statusId === null && data.statusId === undefined) {
    const [active] = await db
      .select({ id: clientStatuses.id })
      .from(clientStatuses)
      .where(eq(clientStatuses.code, "active"))
      .limit(1);
    statusId = active?.id ?? null;
  }
  const managerId =
    data.managerId !== undefined
      ? data.managerId
      : actor.role === "manager" || actor.role === "owner"
        ? actor.id
        : null;

  return retryOnCodeConflict(() =>
    withActor(db, actor.id, async (tx) => {
      const code = await nextClientCode(tx, prefix);
      const [client] = await tx
        .insert(clients)
        .values({
          code,
          name: data.name,
          legalType: data.legalType ?? null,
          edrpou: data.edrpou ?? null,
          iceTypeId: data.iceTypeId ?? null,
          applicationId: data.applicationId ?? null,
          statusId,
          managerId,
          sourceId: data.sourceId ?? null,
          defaultBoxTypeId: data.defaultBoxTypeId ?? null,
          markupPercentOverride: data.markupPercentOverride ?? null,
          notes: data.notes ?? null,
          inactiveDaysThreshold: data.inactiveDaysThreshold ?? null,
        })
        .returning({ id: clients.id, code: clients.code });

      if (phone || data.contactName) {
        await tx.insert(clientContacts).values({
          clientId: client!.id,
          name: data.contactName || null,
          phone,
          isPrimary: true,
        });
      }
      return client!;
    }),
  );
}

/**
 * Підказка «буде АА16» у формі створення: який код отримає клієнт, якщо зберегти зараз. Нічого не
 * блокує, тож справжній код може відрізнятись, якщо хтось створить клієнта раніше. Порожня область
 * означає код з самих цифр.
 */
export async function previewClientCode(
  db: AnyPgDatabase,
  actor: AppUser,
  regionPrefix: string | null | undefined,
): Promise<string> {
  requirePermission(actor, "clients", "write");
  const prefix = await loadRegion(db, regionPrefix);
  return peekNextClientCode(db, prefix);
}

/** Змінює поля клієнта. Код і область тут не міняються (див. `assignClientRegion`). */
export async function updateClient(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  patch: UpdateClientInput,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, clientId);
  const changes = parseInput(updateClientSchema, patch);
  await assertReferences(db, changes);

  const [current] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!current) throw new ValidationError("Клієнта не знайдено.");
  if (current.deletedAt) throw new ValidationError("Клієнта видалено: змінювати його не можна.");

  await withActor(db, actor.id, (tx) => tx.update(clients).set(changes).where(eq(clients.id, id)));
}

/**
 * Клієнт без області («21») отримує область: новий код «літери + номер» (відповідь Романа А1.4:
 * коли такий клієнт зробив перше замовлення, менеджер замінює номер). Старий код записуємо в
 * примітку картки, як і при інших перекодуваннях (D23).
 */
export async function assignClientRegion(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  regionPrefix: string,
): Promise<CreatedClient> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, clientId);
  const prefix = await loadRegion(db, regionPrefix);
  if (!prefix) throw new ValidationError("Оберіть область зі списку.");

  const [current] = await db
    .select({ code: clients.code, notes: clients.notes, deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!current) throw new ValidationError("Клієнта не знайдено.");
  if (current.deletedAt) throw new ValidationError("Клієнта видалено: змінювати його не можна.");
  if (!/^[0-9]+$/.test(current.code)) {
    throw new ValidationError("У цього клієнта вже є область у коді.");
  }

  return retryOnCodeConflict(() =>
    withActor(db, actor.id, async (tx) => {
      const code = await nextClientCode(tx, prefix);
      const line = `Старий код: ${current.code}.`;
      const notes = current.notes ? `${current.notes}\n${line}` : line;
      await tx.update(clients).set({ code, notes }).where(eq(clients.id, id));
      return { id, code };
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Видалення, відновлення, схожі клієнти
// ---------------------------------------------------------------------------------------------

/** Приховує клієнта (D43): лише власник. Код лишається зайнятим, замовлення збережені. */
export async function deleteClient(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  requireRole(actor, "owner");
  const id = parseInput(uuid, clientId);
  const [row] = await db
    .select({ deletedAt: clients.deletedAt, isPlaceholder: clients.isPlaceholder })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!row) throw new ValidationError("Клієнта не знайдено.");
  if (row.isPlaceholder) throw new ValidationError("Службового клієнта видаляти не можна.");
  if (row.deletedAt) throw new ValidationError("Клієнта вже видалено.");
  await withActor(db, actor.id, (tx) =>
    tx.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, id)),
  );
}

/** Повертає видаленого клієнта до списку (лише власник). Об'єднаних дублів не відновлюємо. */
export async function restoreClient(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  requireRole(actor, "owner");
  const id = parseInput(uuid, clientId);
  const [row] = await db
    .select({ deletedAt: clients.deletedAt, mergedIntoId: clients.mergedIntoId })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!row) throw new ValidationError("Клієнта не знайдено.");
  if (!row.deletedAt) throw new ValidationError("Клієнта не видалено.");
  if (row.mergedIntoId) {
    throw new ValidationError("Цього клієнта об'єднано з іншим: відновити його не можна.");
  }
  await withActor(db, actor.id, (tx) =>
    tx.update(clients).set({ deletedAt: null }).where(eq(clients.id, id)),
  );
}

export type SimilarClient = {
  id: string;
  code: string;
  name: string;
  /** Чому схожий: збігається телефон чи назва. */
  reason: "phone" | "name";
};

/**
 * Схожі клієнти для підказки при створенні (D48): той самий телефон або схожа назва. Лише
 * підказка: збереження не блокуємо. Видалених не показуємо.
 */
export async function findSimilarClients(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { name?: string | null; phone?: string | null },
): Promise<SimilarClient[]> {
  requirePermission(actor, "clients", "read");
  const found = new Map<string, SimilarClient>();

  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (phone) {
    const byPhone = await db
      .selectDistinct({ id: clients.id, code: clients.code, name: clients.name })
      .from(clients)
      .innerJoin(clientContacts, eq(clientContacts.clientId, clients.id))
      .where(and(isNull(clients.deletedAt), eq(clientContacts.phone, phone)))
      .limit(SIMILAR_LIMIT);
    for (const row of byPhone) found.set(row.id, { ...row, reason: "phone" });
  }

  const name = input.name?.trim().slice(0, SEARCH_MAX_LENGTH) ?? "";
  if (name.length >= 3) {
    const byName = await db
      .select({ id: clients.id, code: clients.code, name: clients.name })
      .from(clients)
      .where(
        and(
          isNull(clients.deletedAt),
          sql`(lower(${clients.name}) = lower(${name}) or similarity(${clients.name}, ${name}) >= ${SIMILARITY_THRESHOLD})`,
        ),
      )
      .orderBy(sql`similarity(${clients.name}, ${name}) desc`)
      .limit(SIMILAR_LIMIT);
    for (const row of byName) if (!found.has(row.id)) found.set(row.id, { ...row, reason: "name" });
  }
  return [...found.values()].slice(0, SIMILAR_LIMIT);
}
