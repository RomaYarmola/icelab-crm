import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientAddresses, clientContacts, clientOwnBoxes, clients } from "@/db/schema";
import { addressKind } from "@/db/schema/enums";
import type { AnyPgDatabase } from "@/db/types";
import { normalizePhone } from "@/utils/phone";
import { parseInput, ValidationError } from "./errors";
import { lookupNpRefs } from "./np/addresses";
import { type AppUser, requirePermission } from "./guards";

/**
 * Контакти й адреси клієнта (B4). Основний контакт один, адреса за замовчуванням одна: коли
 * вибирають нову, попередню знімаємо в тій самій транзакції. Права: `clients` на запис.
 * Реквізити Нової Пошти (відділення, адреса) тут лише текст: зіставлення з довідниками це B10.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const text = (max: number, message: string) =>
  z.string().trim().max(max, message).nullable().optional();

const contactSchema = z.object({
  name: text(100, "Ім'я контакту надто довге."),
  phone: z.string().nullable().optional(),
  role: text(100, "Посада надто довга."),
  isPrimary: z.boolean().optional(),
});

const addressSchema = z.object({
  kind: z.enum(addressKind.enumValues, "Оберіть вид адреси зі списку."),
  label: z.string().trim().min(1, "Вкажіть назву адреси.").max(100, "Назва адреси надто довга."),
  cityText: text(100, "Назва міста надто довга."),
  addressText: text(300, "Адреса надто довга."),
  recipientName: text(100, "Ім'я отримувача надто довге."),
  recipientPhone: z.string().nullable().optional(),
  /** Місто й відділення чи поштомат з довідника Нової Пошти (вибір у формі). */
  npCityRef: z.string().trim().max(100).nullable().optional(),
  npWarehouseRef: z.string().trim().max(100).nullable().optional(),
  npWarehouseNumber: text(20, "Номер відділення надто довгий."),
  timeWindow: text(50, "Вікно доставки надто довге."),
  isDefault: z.boolean().optional(),
});

export type ContactInput = z.input<typeof contactSchema>;
export type AddressInput = z.input<typeof addressSchema>;

const blankToNull = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === "" ? null : value.trim();

function parseContactPhone(input: string | null | undefined): string | null {
  const value = blankToNull(input);
  if (value === null) return null;
  const phone = normalizePhone(value);
  if (!phone) {
    throw new ValidationError("Не вдалося розпізнати телефон. Вкажіть, наприклад, 050 123 45 67.");
  }
  return phone;
}

/** Клієнт має існувати і не бути видаленим: інакше змінювати його дані не можна. */
async function assertEditableClient(db: AnyPgDatabase, clientId: string) {
  const [row] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row) throw new ValidationError("Клієнта не знайдено.");
  if (row.deletedAt) throw new ValidationError("Клієнта видалено: змінювати його не можна.");
}

// ---------------------------------------------------------------------------------------------
// Контакти
// ---------------------------------------------------------------------------------------------

export async function addContact(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  input: ContactInput,
): Promise<{ id: string }> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, clientId);
  const data = parseInput(contactSchema, input);
  const name = blankToNull(data.name);
  const phone = parseContactPhone(data.phone);
  if (!name && !phone) throw new ValidationError("Вкажіть ім'я або телефон контакту.");
  await assertEditableClient(db, id);

  return withActor(db, actor.id, async (tx) => {
    const existing = await tx
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id));
    // Перший контакт завжди основний.
    const isPrimary = data.isPrimary === true || existing.length === 0;
    if (isPrimary) {
      await tx
        .update(clientContacts)
        .set({ isPrimary: false })
        .where(eq(clientContacts.clientId, id));
    }
    const [row] = await tx
      .insert(clientContacts)
      .values({ clientId: id, name, phone, role: blankToNull(data.role), isPrimary })
      .returning({ id: clientContacts.id });
    return row!;
  });
}

export async function updateContact(
  db: AnyPgDatabase,
  actor: AppUser,
  contactId: string,
  input: ContactInput,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, contactId);
  const data = parseInput(contactSchema, input);
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, id))
    .limit(1);
  if (!contact) throw new ValidationError("Контакт не знайдено.");
  await assertEditableClient(db, contact.clientId);

  const name = blankToNull(data.name);
  const phone = parseContactPhone(data.phone);
  if (!name && !phone) throw new ValidationError("Вкажіть ім'я або телефон контакту.");

  await withActor(db, actor.id, async (tx) => {
    if (data.isPrimary === true) {
      await tx
        .update(clientContacts)
        .set({ isPrimary: false })
        .where(and(eq(clientContacts.clientId, contact.clientId), ne(clientContacts.id, id)));
    }
    await tx
      .update(clientContacts)
      .set({
        name,
        phone,
        role: blankToNull(data.role),
        // Зняти «основний» з єдиного контакту не можна: хтось має бути основним.
        ...(data.isPrimary === undefined ? {} : { isPrimary: data.isPrimary || contact.isPrimary }),
      })
      .where(eq(clientContacts.id, id));
  });
}

export async function deleteContact(
  db: AnyPgDatabase,
  actor: AppUser,
  contactId: string,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, contactId);
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, id))
    .limit(1);
  if (!contact) throw new ValidationError("Контакт не знайдено.");
  await assertEditableClient(db, contact.clientId);

  await withActor(db, actor.id, async (tx) => {
    await tx.delete(clientContacts).where(eq(clientContacts.id, id));
    if (contact.isPrimary) {
      // Основним стає найстаріший із решти.
      const [next] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, contact.clientId))
        .orderBy(asc(clientContacts.createdAt))
        .limit(1);
      if (next)
        await tx
          .update(clientContacts)
          .set({ isPrimary: true })
          .where(eq(clientContacts.id, next.id));
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Адреси
// ---------------------------------------------------------------------------------------------

const isNpKind = (kind: string) => kind === "np_warehouse" || kind === "np_address";

function assertAddressFilled(data: z.output<typeof addressSchema>) {
  const filled = [data.cityText, data.addressText, data.npWarehouseNumber, data.npCityRef].some(
    (value) => blankToNull(value) !== null,
  );
  if (!filled) throw new ValidationError("Вкажіть місто, адресу або номер відділення.");
  // Адреси Нової Пошти (20.11.2026): отримувач і його телефон обов'язкові.
  if (isNpKind(data.kind)) {
    if (blankToNull(data.recipientName) === null) throw new ValidationError("Вкажіть отримувача.");
    if (blankToNull(data.recipientPhone) === null) {
      throw new ValidationError("Вкажіть телефон отримувача.");
    }
    if (data.kind === "np_address" && blankToNull(data.addressText) === null) {
      throw new ValidationError("Вкажіть адресу для кур'єра: вулицю й будинок.");
    }
  }
}

/** Телефон отримувача у форматі +380…; для адрес Нової Пошти він обов'язковий. */
function parseRecipientPhone(data: z.output<typeof addressSchema>): string | null {
  const value = blankToNull(data.recipientPhone);
  if (value === null) return null;
  const phone = normalizePhone(value);
  if (!phone) {
    throw new ValidationError(
      "Не вдалося розпізнати телефон отримувача. Вкажіть, наприклад, 050 123 45 67.",
    );
  }
  return phone;
}

/**
 * Значення адреси для запису. Для Нової Пошти: місто й відділення чи поштомат беремо з довідника
 * (якщо їх вибрано), тож адреса одразу зіставлена; вікна доставки й текстової адреси для відділення
 * немає, для кур'єра немає вікна.
 */
async function addressValues(tx: AnyPgDatabase, data: z.output<typeof addressSchema>) {
  const base = {
    kind: data.kind,
    label: blankToNull(data.label),
    cityText: blankToNull(data.cityText),
    addressText: blankToNull(data.addressText),
    recipientName: blankToNull(data.recipientName),
    recipientPhone: parseRecipientPhone(data),
    npWarehouseNumber: blankToNull(data.npWarehouseNumber),
    timeWindow: isNpKind(data.kind) ? null : blankToNull(data.timeWindow),
    npCityRef: null as string | null,
    npWarehouseRef: null as string | null,
    isResolved: false,
  };
  if (!isNpKind(data.kind) || !data.npCityRef) return base;
  const refs = await lookupNpRefs(
    tx,
    data.npCityRef,
    data.kind === "np_warehouse" ? data.npWarehouseRef : null,
  );
  return {
    ...base,
    cityText: refs.city.nameUa,
    addressText: data.kind === "np_warehouse" ? null : base.addressText,
    npWarehouseNumber: refs.warehouse?.number ?? null,
    npCityRef: refs.city.ref,
    npWarehouseRef: refs.warehouse?.ref ?? null,
    // Відділення чи поштомат без вибраного відділення ще не зіставлені.
    isResolved: data.kind === "np_address" || refs.warehouse !== null,
  };
}

export async function addAddress(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  input: AddressInput,
): Promise<{ id: string }> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, clientId);
  const data = parseInput(addressSchema, input);
  assertAddressFilled(data);
  await assertEditableClient(db, id);

  return withActor(db, actor.id, async (tx) => {
    const existing = await tx
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(eq(clientAddresses.clientId, id));
    const isDefault = data.isDefault === true || existing.length === 0;
    if (isDefault) {
      await tx
        .update(clientAddresses)
        .set({ isDefault: false })
        .where(eq(clientAddresses.clientId, id));
    }
    const [row] = await tx
      .insert(clientAddresses)
      .values({ clientId: id, ...(await addressValues(tx, data)), isDefault })
      .returning({ id: clientAddresses.id });
    return row!;
  });
}

export async function updateAddress(
  db: AnyPgDatabase,
  actor: AppUser,
  addressId: string,
  input: AddressInput,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, addressId);
  const data = parseInput(addressSchema, input);
  assertAddressFilled(data);
  const [address] = await db
    .select()
    .from(clientAddresses)
    .where(eq(clientAddresses.id, id))
    .limit(1);
  if (!address) throw new ValidationError("Адресу не знайдено.");
  await assertEditableClient(db, address.clientId);

  await withActor(db, actor.id, async (tx) => {
    if (data.isDefault === true) {
      await tx
        .update(clientAddresses)
        .set({ isDefault: false })
        .where(and(eq(clientAddresses.clientId, address.clientId), ne(clientAddresses.id, id)));
    }
    await tx
      .update(clientAddresses)
      .set({
        ...(await addressValues(tx, data)),
        ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault || address.isDefault }),
      })
      .where(eq(clientAddresses.id, id));
  });
}

export async function deleteAddress(
  db: AnyPgDatabase,
  actor: AppUser,
  addressId: string,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, addressId);
  const [address] = await db
    .select()
    .from(clientAddresses)
    .where(eq(clientAddresses.id, id))
    .limit(1);
  if (!address) throw new ValidationError("Адресу не знайдено.");
  await assertEditableClient(db, address.clientId);

  await withActor(db, actor.id, async (tx) => {
    await tx.delete(clientAddresses).where(eq(clientAddresses.id, id));
    if (address.isDefault) {
      const [next] = await tx
        .select({ id: clientAddresses.id })
        .from(clientAddresses)
        .where(eq(clientAddresses.clientId, address.clientId))
        .orderBy(asc(clientAddresses.createdAt))
        .limit(1);
      if (next)
        await tx
          .update(clientAddresses)
          .set({ isDefault: true })
          .where(eq(clientAddresses.id, next.id));
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Бокси клієнта (D164)
// ---------------------------------------------------------------------------------------------

/** Число з поля форми (з комою): порожнє дає `undefined`, не число чи не цілий мм дають помилку. */
const optionalNumber = (label: string, opts: { integer?: boolean; max: number; min?: number }) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || String(value).trim() === "") return null;
      const parsed = Number(String(value).trim().replace(",", "."));
      if (
        !Number.isFinite(parsed) ||
        parsed < (opts.min ?? 0) ||
        parsed > opts.max ||
        (opts.integer && !Number.isInteger(parsed))
      ) {
        ctx.addIssue({
          code: "custom",
          message: `${label}: вкажіть ${opts.integer ? "ціле " : ""}число від ${opts.min ?? 0} до ${opts.max}.`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const ownBoxSchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву бокса.").max(100, "Назва бокса надто довга."),
  volumeL: optionalNumber("Об'єм, л", { integer: true, min: 1, max: 1000 }),
  capacityKg: optionalNumber("Вміщає, кг", { min: 0.001, max: 1000 }),
  emptyWeightKg: optionalNumber("Вага порожнього, кг", { max: 200 }),
  heightMm: optionalNumber("Висота, мм", { integer: true, min: 1, max: 3000 }),
  widthMm: optionalNumber("Ширина, мм", { integer: true, min: 1, max: 3000 }),
  lengthMm: optionalNumber("Довжина, мм", { integer: true, min: 1, max: 3000 }),
  note: text(300, "Примітка надто довга."),
});

export type OwnBoxInput = z.input<typeof ownBoxSchema>;

const ownBoxValues = (data: z.output<typeof ownBoxSchema>) => ({
  name: data.name,
  volumeL: data.volumeL,
  capacityKg: data.capacityKg === null ? null : data.capacityKg.toFixed(3),
  emptyWeightKg: data.emptyWeightKg === null ? null : data.emptyWeightKg.toFixed(3),
  heightMm: data.heightMm,
  widthMm: data.widthMm,
  lengthMm: data.lengthMm,
  note: blankToNull(data.note),
});

export async function addOwnBox(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
  input: OwnBoxInput,
): Promise<{ id: string }> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, clientId);
  const data = parseInput(ownBoxSchema, input);
  await assertEditableClient(db, id);
  return withActor(db, actor.id, async (tx) => {
    const [row] = await tx
      .insert(clientOwnBoxes)
      .values({ clientId: id, ...ownBoxValues(data) })
      .returning({ id: clientOwnBoxes.id });
    return row!;
  });
}

export async function updateOwnBox(
  db: AnyPgDatabase,
  actor: AppUser,
  boxId: string,
  input: OwnBoxInput,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, boxId);
  const data = parseInput(ownBoxSchema, input);
  const [box] = await db.select().from(clientOwnBoxes).where(eq(clientOwnBoxes.id, id)).limit(1);
  if (!box) throw new ValidationError("Бокс не знайдено.");
  await assertEditableClient(db, box.clientId);
  await withActor(db, actor.id, async (tx) => {
    await tx.update(clientOwnBoxes).set(ownBoxValues(data)).where(eq(clientOwnBoxes.id, id));
  });
}

/** Видаляє бокс; замовлення, що його використовували, лишаються без вибраного бокса. */
export async function deleteOwnBox(
  db: AnyPgDatabase,
  actor: AppUser,
  boxId: string,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const id = parseInput(uuid, boxId);
  const [box] = await db.select().from(clientOwnBoxes).where(eq(clientOwnBoxes.id, id)).limit(1);
  if (!box) throw new ValidationError("Бокс не знайдено.");
  await assertEditableClient(db, box.clientId);
  await withActor(db, actor.id, async (tx) => {
    await tx.delete(clientOwnBoxes).where(eq(clientOwnBoxes.id, id));
  });
}

export type OwnBoxView = {
  id: string;
  name: string;
  volumeL: number | null;
  capacityKg: string | null;
  emptyWeightKg: string | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  note: string | null;
};

/** Бокси клієнта для картки клієнта й форми замовлення. */
export async function listOwnBoxes(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<OwnBoxView[]> {
  requirePermission(actor, "clients", "read");
  const id = parseInput(uuid, clientId);
  const rows = await db
    .select()
    .from(clientOwnBoxes)
    .where(eq(clientOwnBoxes.clientId, id))
    .orderBy(asc(clientOwnBoxes.name));
  return rows.map(
    ({ id, name, volumeL, capacityKg, emptyWeightKg, heightMm, widthMm, lengthMm, note }) => ({
      id,
      name,
      volumeL,
      capacityKg,
      emptyWeightKg,
      heightMm,
      widthMm,
      lengthMm,
      note,
    }),
  );
}
