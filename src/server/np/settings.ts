import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { boxTypes, locations, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "../errors";
import { type AppUser, requirePermission } from "../guards";
import { callNp, getNpApiKey, NpError } from "./client";

/**
 * Налаштування Нової Пошти для власника (B10, ТЗ 6.12): чи є ключ, перевірка з'єднання, відправник
 * для кожної локації і вага порожніх боксів. Ключ у базі не зберігаємо (D122): тут лише те, чи він
 * є, та результат останньої перевірки.
 */

const CHECK_KEY = "np.last_check";
const senderLabelKey = (locationCode: string) => `np.sender_labels.${locationCode}`;

function assertOwner(actor: AppUser): void {
  requirePermission(actor, "migration_settings", "write");
}

export type NpLastCheck = { ok: boolean; at: string; message: string };

export type NpLocationSender = {
  locationId: string;
  code: string;
  name: string;
  isConfigured: boolean;
  phone: string | null;
  senderName: string | null;
  contactName: string | null;
  addressName: string | null;
};

export type NpSettingsView = {
  hasKey: boolean;
  lastCheck: NpLastCheck | null;
  locations: NpLocationSender[];
  boxTypes: { id: string; name: string; emptyWeightKg: string | null }[];
};

type SenderLabels = { sender?: string; contact?: string; address?: string; cityRef?: string };

async function readSetting<T>(db: AnyPgDatabase, key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? null;
}

/** Екран «Нова Пошта»: стан ключа, відправники локацій і вага тари. */
export async function getNpSettings(db: AnyPgDatabase, actor: AppUser): Promise<NpSettingsView> {
  assertOwner(actor);
  const [lastCheck, locationRows, typeRows] = await Promise.all([
    readSetting<NpLastCheck>(db, CHECK_KEY),
    db.select().from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name)),
    db
      .select({
        id: boxTypes.id,
        name: boxTypes.name,
        emptyWeightKg: boxTypes.emptyWeightKg,
      })
      .from(boxTypes)
      .where(and(eq(boxTypes.isActive, true), eq(boxTypes.isClientOwned, false)))
      .orderBy(asc(boxTypes.sort)),
  ]);
  const labels = await Promise.all(
    locationRows.map((row) => readSetting<SenderLabels>(db, senderLabelKey(row.code))),
  );
  return {
    hasKey: getNpApiKey() !== null,
    lastCheck,
    locations: locationRows.map((row, index) => ({
      locationId: row.id,
      code: row.code,
      name: row.name,
      isConfigured: Boolean(row.npSenderRef && row.npSenderContactRef && row.npSenderAddressRef),
      phone: row.npSenderPhone,
      senderName: labels[index]?.sender ?? null,
      contactName: labels[index]?.contact ?? null,
      addressName: labels[index]?.address ?? null,
    })),
    boxTypes: typeRows,
  };
}

async function writeSetting(
  tx: Parameters<Parameters<AnyPgDatabase["transaction"]>[0]>[0],
  key: string,
  value: unknown,
): Promise<void> {
  await tx
    .insert(settings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object } });
}

/** «Перевірити з'єднання»: найдешевший виклик (список відправників). Результат зберігаємо. */
export async function checkNpConnection(db: AnyPgDatabase, actor: AppUser): Promise<NpLastCheck> {
  assertOwner(actor);
  let result: NpLastCheck;
  try {
    const { data } = await callNp(db, {
      modelName: "Counterparty",
      calledMethod: "getCounterparties",
      methodProperties: { CounterpartyProperty: "Sender", Page: "1", Limit: "20" },
    });
    result = {
      ok: true,
      at: new Date().toISOString(),
      message: `З'єднання працює. Відправників у вашому акаунті: ${data.length}.`,
    };
  } catch (error) {
    if (!(error instanceof NpError)) throw error;
    result = { ok: false, at: new Date().toISOString(), message: error.message };
  }
  await withActor(db, actor.id, (tx) => writeSetting(tx, CHECK_KEY, result));
  return result;
}

// ---------------------------------------------------------------------------------------------
// Відправник локації
// ---------------------------------------------------------------------------------------------

export type NpOption = { ref: string; name: string; cityRef?: string };

type RawRef = { Ref?: string; Description?: string; CityRef?: string };

const toOptions = (rows: RawRef[]): NpOption[] =>
  rows
    .filter((row): row is RawRef & { Ref: string } => typeof row.Ref === "string")
    .map((row) => ({
      ref: row.Ref,
      name: row.Description?.trim() || row.Ref,
      ...(row.CityRef ? { cityRef: row.CityRef } : {}),
    }));

/** Відправники (контрагенти) з акаунта Нової Пошти. */
export async function listNpSenders(db: AnyPgDatabase, actor: AppUser): Promise<NpOption[]> {
  assertOwner(actor);
  const { data } = await callNp<RawRef>(db, {
    modelName: "Counterparty",
    calledMethod: "getCounterparties",
    methodProperties: { CounterpartyProperty: "Sender", Page: "1", Limit: "50" },
  });
  return toOptions(data);
}

/** Контактні особи й адреси вибраного відправника. */
export async function listNpSenderDetails(
  db: AnyPgDatabase,
  actor: AppUser,
  senderRef: string,
): Promise<{ contacts: NpOption[]; addresses: NpOption[] }> {
  assertOwner(actor);
  const ref = parseInput(z.string().min(1, "Оберіть відправника.").max(100), senderRef);
  const [contacts, addresses] = await Promise.all([
    callNp<RawRef>(db, {
      modelName: "Counterparty",
      calledMethod: "getCounterpartyContactPersons",
      methodProperties: { Ref: ref, Page: "1" },
    }),
    callNp<RawRef>(db, {
      modelName: "Counterparty",
      calledMethod: "getCounterpartyAddresses",
      methodProperties: { Ref: ref, CounterpartyProperty: "Sender" },
    }),
  ]);
  return { contacts: toOptions(contacts.data), addresses: toOptions(addresses.data) };
}

const PHONE = /^\+380[0-9]{9}$/;

const senderSchema = z.object({
  locationId: z.string().uuid("Оберіть локацію."),
  senderRef: z.string().min(1, "Оберіть відправника.").max(100),
  contactRef: z.string().min(1, "Оберіть контактну особу.").max(100),
  addressRef: z.string().min(1, "Оберіть адресу відправлення.").max(100),
  /** Місто адреси відправлення: Нова Пошта вимагає його в накладній. */
  cityRef: z.string().min(1, "У адреси відправлення немає міста. Оберіть іншу адресу.").max(100),
  phone: z.string().regex(PHONE, "Телефон у форматі +380501234567."),
  senderName: z.string().max(200).optional(),
  contactName: z.string().max(200).optional(),
  addressName: z.string().max(300).optional(),
});

export type SaveLocationSenderInput = z.input<typeof senderSchema>;

/** Зберігає відправника локації (контрагент, контактна особа, адреса, телефон). Лише власник. */
export async function saveLocationSender(
  db: AnyPgDatabase,
  actor: AppUser,
  input: SaveLocationSenderInput,
): Promise<void> {
  assertOwner(actor);
  const data = parseInput(senderSchema, input);
  await withActor(db, actor.id, async (tx) => {
    const [location] = await tx.select().from(locations).where(eq(locations.id, data.locationId));
    if (!location) throw new ValidationError("Локацію не знайдено.");
    await tx
      .update(locations)
      .set({
        npSenderRef: data.senderRef,
        npSenderContactRef: data.contactRef,
        npSenderAddressRef: data.addressRef,
        npSenderPhone: data.phone,
      })
      .where(eq(locations.id, data.locationId));
    await writeSetting(tx, senderLabelKey(location.code), {
      sender: data.senderName ?? "",
      contact: data.contactName ?? "",
      address: data.addressName ?? "",
      cityRef: data.cityRef,
    } satisfies SenderLabels);
  });
}

// ---------------------------------------------------------------------------------------------
// Вага порожніх боксів
// ---------------------------------------------------------------------------------------------

export const MAX_EMPTY_WEIGHT_KG = 100;

/** Вага порожнього бокса в кг (D127). Порожнє значення знімає вагу. Лише власник. */
export async function setBoxTypeEmptyWeight(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { boxTypeId: string; weightKg: string | null },
): Promise<void> {
  assertOwner(actor);
  const boxTypeId = parseInput(z.string().uuid("Оберіть тип бокса."), input.boxTypeId);
  const raw = input.weightKg?.trim().replace(",", ".") ?? "";
  let weight: string | null = null;
  if (raw !== "") {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_EMPTY_WEIGHT_KG) {
      throw new ValidationError(`Вага від 0,001 до ${MAX_EMPTY_WEIGHT_KG} кг.`);
    }
    weight = value.toFixed(3);
  }
  await withActor(db, actor.id, async (tx) => {
    const updated = await tx
      .update(boxTypes)
      .set({ emptyWeightKg: weight })
      .where(eq(boxTypes.id, boxTypeId))
      .returning({ id: boxTypes.id });
    if (updated.length === 0) throw new ValidationError("Тип бокса не знайдено.");
  });
}
