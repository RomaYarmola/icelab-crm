"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import {
  addCo2Receipt,
  addIceWriteoff,
  type Co2EntryKind,
  deleteCo2Entry,
  setCo2Norm,
  setCo2Stock,
} from "@/server/finance/co2";
import { readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";

/** Дії екрана «Фінрезультат» (B15). Права й значення перевіряють функції `server/finance`. */

/** Прихід CO2. */
export async function addCo2ReceiptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    locationId: readText(formData, "locationId"),
    receivedOn: readText(formData, "receivedOn"),
    kg: readText(formData, "kg"),
    pricePerKg: readText(formData, "pricePerKg"),
    note: readText(formData, "note"),
  };
  return runFormAction(
    async () => {
      await addCo2Receipt(getDb(), actor, values);
      revalidatePath("/finance");
    },
    { success: "Прихід збережено.", values },
  );
}

/** Списаний лід (D240). */
export async function addIceWriteoffAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    locationId: readText(formData, "locationId"),
    writtenOffOn: readText(formData, "writtenOffOn"),
    kg: readText(formData, "kg"),
    note: readText(formData, "note"),
  };
  return runFormAction(
    async () => {
      await addIceWriteoff(getDb(), actor, values);
      revalidatePath("/finance");
    },
    { success: "Списання збережено.", values },
  );
}

/** Виправлення залишку за фактом. */
export async function setCo2StockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    locationId: readText(formData, "locationId"),
    actualKg: readText(formData, "actualKg"),
    note: readText(formData, "note"),
  };
  return runFormAction(
    async () => {
      await setCo2Stock(getDb(), actor, values);
      revalidatePath("/finance");
    },
    { success: "Залишок виправлено.", values },
  );
}

/** Норма CO2 з дати. */
export async function setCo2NormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    locationId: readText(formData, "locationId"),
    validFrom: readText(formData, "validFrom"),
    norm: readText(formData, "norm"),
  };
  return runFormAction(
    async () => {
      await setCo2Norm(getDb(), actor, values);
      revalidatePath("/finance");
    },
    { success: "Норму збережено.", values },
  );
}

async function remove(kind: Co2EntryKind, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await deleteCo2Entry(getDb(), actor, kind, readText(formData, "id"));
      revalidatePath("/finance");
    },
    { success: "Запис видалено." },
  );
}

export async function deleteCo2ReceiptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return remove("receipt", formData);
}

export async function deleteIceWriteoffAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return remove("writeoff", formData);
}

export async function deleteCo2AdjustmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return remove("adjustment", formData);
}

export async function deleteCo2NormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return remove("norm", formData);
}
