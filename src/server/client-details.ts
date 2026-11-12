import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientAddresses, clientContacts, clients } from "@/db/schema";
import { addressKind } from "@/db/schema/enums";
import type { AnyPgDatabase } from "@/db/types";
import { normalizePhone } from "@/utils/phone";
import { parseInput, ValidationError } from "./errors";
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
  label: text(100, "Назва адреси надто довга."),
  cityText: text(100, "Назва міста надто довга."),
  addressText: text(300, "Адреса надто довга."),
  recipientName: text(100, "Ім'я отримувача надто довге."),
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

function assertAddressFilled(data: z.output<typeof addressSchema>) {
  const filled = [data.cityText, data.addressText, data.npWarehouseNumber].some(
    (value) => blankToNull(value) !== null,
  );
  if (!filled) throw new ValidationError("Вкажіть місто, адресу або номер відділення.");
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
      .values({
        clientId: id,
        kind: data.kind,
        label: blankToNull(data.label),
        cityText: blankToNull(data.cityText),
        addressText: blankToNull(data.addressText),
        recipientName: blankToNull(data.recipientName),
        npWarehouseNumber: blankToNull(data.npWarehouseNumber),
        timeWindow: blankToNull(data.timeWindow),
        isDefault,
      })
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
        kind: data.kind,
        label: blankToNull(data.label),
        cityText: blankToNull(data.cityText),
        addressText: blankToNull(data.addressText),
        recipientName: blankToNull(data.recipientName),
        npWarehouseNumber: blankToNull(data.npWarehouseNumber),
        timeWindow: blankToNull(data.timeWindow),
        ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault || address.isDefault }),
        // Текст змінили, тож зіставлення з довідниками Нової Пошти (B10) уже не діє.
        isResolved: false,
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
