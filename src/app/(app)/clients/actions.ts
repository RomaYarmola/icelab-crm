"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import {
  type AddressInput,
  addAddress,
  addContact,
  deleteAddress,
  deleteContact,
  updateAddress,
  updateContact,
} from "@/server/client-details";
import { mergeClients } from "@/server/client-merge";
import {
  assignClientRegion,
  type ClientListPage,
  type ClientListQuery,
  type CreateClientInput,
  createClient,
  deleteClient,
  findSimilarClients,
  listClients,
  previewClientCode,
  restoreClient,
  type SimilarClient,
  updateClient,
} from "@/server/clients";
import { reportError } from "@/server/error-log";
import { ValidationError } from "@/server/errors";
import {
  readFlag,
  readOptionalInt,
  readOptionalText,
  readText,
  runFormAction,
  UNEXPECTED_ERROR_MESSAGE,
} from "@/server/form-state";
import { ForbiddenError } from "@/server/guards";
import { changeClientPrice } from "@/server/prices";
import type { FormState } from "@/utils/formState";

/**
 * Дії розділу «Клієнти»: кожна читає поля форми, викликає серверну функцію (права перевіряє вона)
 * і повертає стан для екрана. Помилки введення повертаються з введеними значеннями.
 */

function refresh() {
  revalidatePath("/clients", "layout");
}

function readId(formData: FormData, name = "id"): string {
  const parsed = z.uuid().safeParse(readText(formData, name));
  if (!parsed.success) throw new ValidationError("Запис не знайдено.");
  return parsed.data;
}

/** Поля картки клієнта з форми (однакові для створення й зміни). */
function readClientFields(formData: FormData) {
  return {
    name: readText(formData, "name"),
    // Значення перевіряє схема всередині серверної функції.
    legalType: readOptionalText(formData, "legalType") as CreateClientInput["legalType"],
    edrpou: readOptionalText(formData, "edrpou"),
    iceTypeId: readOptionalText(formData, "iceTypeId"),
    applicationId: readOptionalText(formData, "applicationId"),
    statusId: readOptionalText(formData, "statusId"),
    managerId: readOptionalText(formData, "managerId"),
    sourceId: readOptionalText(formData, "sourceId"),
    defaultBoxTypeId: readOptionalText(formData, "defaultBoxTypeId"),
    markupPercentOverride: readOptionalText(formData, "markupPercentOverride"),
    inactiveDaysThreshold: readOptionalInt(formData, "inactiveDaysThreshold"),
    notes: readOptionalText(formData, "notes"),
  };
}

const CLIENT_FIELD_NAMES = [
  "name",
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
  "notes",
];

function echo(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, readText(formData, name)]));
}

// ---------------------------------------------------------------------------------------------
// Читання для екранів: «Показати ще» у списку і підказка «Схожі клієнти»
// ---------------------------------------------------------------------------------------------

export type LoadMoreResult = { ok: true; page: ClientListPage } | { ok: false; message: string };

const loadMoreSchema = z.object({
  search: z.string().max(200).optional(),
  statusId: z.string().max(64).optional(),
  managerId: z.string().max(64).optional(),
  applicationId: z.string().max(64).optional(),
  includeDeleted: z.boolean().optional(),
  offset: z.number().int().min(0).max(100_000),
});

/** Наступна частина списку клієнтів (кнопка «Показати ще»). Права й значення перевіряє `listClients`. */
export async function loadMoreClientsAction(
  filters: Omit<ClientListQuery, "limit" | "offset"> & { offset: number },
): Promise<LoadMoreResult> {
  const actor = await requireUser();
  const parsed = loadMoreSchema.safeParse(filters);
  if (!parsed.success) return { ok: false, message: "Не вдалося завантажити клієнтів." };
  try {
    return { ok: true, page: await listClients(getDb(), actor, parsed.data) };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    await reportError({ source: "form_action", error });
    return { ok: false, message: UNEXPECTED_ERROR_MESSAGE };
  }
}

/**
 * Підказка при створенні клієнта (D48): схожі за назвою чи телефоном. Лише підказка, тож будь-яка
 * помилка дає порожній список, а не повідомлення.
 */
export async function findSimilarClientsAction(input: {
  name?: string;
  phone?: string;
}): Promise<SimilarClient[]> {
  const actor = await requireUser();
  try {
    return await findSimilarClients(getDb(), actor, {
      name: typeof input.name === "string" ? input.name : null,
      phone: typeof input.phone === "string" ? input.phone : null,
    });
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return [];
  }
}

/** Підказка «буде АА16» у формі. Помилка (невідома область, немає прав) дає `null`: підказка зникає. */
export async function previewClientCodeAction(regionPrefix: string): Promise<string | null> {
  const actor = await requireUser();
  try {
    return await previewClientCode(
      getDb(),
      actor,
      typeof regionPrefix === "string" ? regionPrefix : "",
    );
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return null;
  }
}

export async function createClientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, [...CLIENT_FIELD_NAMES, "regionPrefix", "phone", "contactName"]);
  let created: { id: string; code: string } | undefined;

  const state = await runFormAction(
    async () => {
      created = await createClient(getDb(), actor, {
        ...readClientFields(formData),
        // Без поля статусу сервер ставить «Активний»: не передаємо порожнє значення.
        statusId: readOptionalText(formData, "statusId") ?? undefined,
        managerId: readOptionalText(formData, "managerId") ?? undefined,
        regionPrefix: readOptionalText(formData, "regionPrefix"),
        phone: readOptionalText(formData, "phone"),
        contactName: readOptionalText(formData, "contactName"),
      });
    },
    { success: "Клієнта створено.", values },
  );

  if (created) {
    refresh();
    redirect(`/clients/${created.id}?created=1`);
  }
  return state;
}

export async function updateClientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, CLIENT_FIELD_NAMES);
  return runFormAction(
    async () => {
      await updateClient(getDb(), actor, readId(formData), readClientFields(formData));
      refresh();
    },
    { success: "Зміни збережено.", values },
  );
}

export async function assignRegionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await assignClientRegion(
        getDb(),
        actor,
        readId(formData),
        readText(formData, "regionPrefix"),
      );
      refresh();
    },
    { success: "Область додано, код змінено." },
  );
}

export async function deleteClientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const state = await runFormAction(
    async () => {
      await deleteClient(getDb(), actor, readId(formData));
      refresh();
    },
    { success: "Клієнта видалено." },
  );
  if (state.status === "success") redirect("/clients");
  return state;
}

export async function restoreClientAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await restoreClient(getDb(), actor, readId(formData));
      refresh();
    },
    { success: "Клієнта повернуто до списку." },
  );
}

// ---------------------------------------------------------------------------------------------
// Контакти й адреси
// ---------------------------------------------------------------------------------------------

function readContact(formData: FormData) {
  return {
    name: readOptionalText(formData, "name"),
    phone: readOptionalText(formData, "phone"),
    role: readOptionalText(formData, "role"),
    isPrimary: readFlag(formData, "isPrimary"),
  };
}

export async function addContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ["name", "phone", "role"]);
  return runFormAction(
    async () => {
      await addContact(getDb(), actor, readId(formData, "clientId"), readContact(formData));
      refresh();
    },
    { success: "Контакт додано.", values },
  );
}

export async function updateContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ["name", "phone", "role"]);
  return runFormAction(
    async () => {
      await updateContact(getDb(), actor, readId(formData), readContact(formData));
      refresh();
    },
    { success: "Контакт збережено.", values },
  );
}

export async function deleteContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await deleteContact(getDb(), actor, readId(formData));
      refresh();
    },
    { success: "Контакт видалено." },
  );
}

function readAddress(formData: FormData) {
  return {
    kind: readText(formData, "kind") as AddressInput["kind"],
    label: readOptionalText(formData, "label"),
    cityText: readOptionalText(formData, "cityText"),
    addressText: readOptionalText(formData, "addressText"),
    recipientName: readOptionalText(formData, "recipientName"),
    npWarehouseNumber: readOptionalText(formData, "npWarehouseNumber"),
    timeWindow: readOptionalText(formData, "timeWindow"),
    isDefault: readFlag(formData, "isDefault"),
  };
}

const ADDRESS_FIELD_NAMES = [
  "kind",
  "label",
  "cityText",
  "addressText",
  "recipientName",
  "npWarehouseNumber",
  "timeWindow",
];

export async function addAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ADDRESS_FIELD_NAMES);
  return runFormAction(
    async () => {
      await addAddress(getDb(), actor, readId(formData, "clientId"), readAddress(formData));
      refresh();
    },
    { success: "Адресу додано.", values },
  );
}

export async function updateAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ADDRESS_FIELD_NAMES);
  return runFormAction(
    async () => {
      await updateAddress(getDb(), actor, readId(formData), readAddress(formData));
      refresh();
    },
    { success: "Адресу збережено.", values },
  );
}

export async function deleteAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await deleteAddress(getDb(), actor, readId(formData));
      refresh();
    },
    { success: "Адресу видалено." },
  );
}

// ---------------------------------------------------------------------------------------------
// Ціни клієнта і об'єднання
// ---------------------------------------------------------------------------------------------

export async function changeClientPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ["iceTypeId", "pricePerKg", "validFrom"]);
  return runFormAction(
    async () => {
      await changeClientPrice(getDb(), actor, {
        clientId: readId(formData, "clientId"),
        iceTypeId: readOptionalText(formData, "iceTypeId"),
        pricePerKg: readText(formData, "pricePerKg"),
        validFrom: readText(formData, "validFrom"),
      });
      refresh();
    },
    { success: "Нову ціну збережено.", values },
  );
}

export async function mergeClientsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  let mainId: string | undefined;
  const state = await runFormAction(
    async () => {
      mainId = readId(formData, "mainId");
      await mergeClients(getDb(), actor, mainId, readId(formData, "duplicateId"));
      refresh();
    },
    { success: "Клієнтів об'єднано." },
  );
  if (state.status === "success" && mainId) redirect(`/clients/${mainId}?merged=1`);
  return state;
}
