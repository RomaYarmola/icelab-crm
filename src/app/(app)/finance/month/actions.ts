"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import {
  addCategory,
  closeMonth,
  reopenMonth,
  saveLedgerEntries,
  setCommissionRate,
  setUsdRate,
  updateCategory,
} from "@/server/finance/month";
import type { AppUser } from "@/server/guards";
import { readFlag, readOptionalText, readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";

/** Дії екрана «Фінрезультат → Місяць» (B15). Права й значення перевіряють функції `server/finance`. */

async function run(
  success: string,
  values: Record<string, string>,
  task: (actor: AppUser) => Promise<void>,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await task(actor);
      revalidatePath("/finance", "layout");
    },
    { success, values },
  );
}

export async function saveEntriesAction(_previous: FormState, formData: FormData) {
  const values: Record<string, string> = {};
  const amounts: { categoryId: string; amount: string }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("amount:") || typeof value !== "string") continue;
    values[name] = value;
    amounts.push({ categoryId: name.slice("amount:".length), amount: value });
  }
  return run("Суми збережено.", values, (actor) =>
    saveLedgerEntries(getDb(), actor, {
      month: readText(formData, "month"),
      locationId: readOptionalText(formData, "locationId"),
      amounts,
    }),
  );
}

export async function setUsdRateAction(_previous: FormState, formData: FormData) {
  const values = { usdRate: readText(formData, "usdRate") };
  return run("Курс збережено.", values, (actor) =>
    setUsdRate(getDb(), actor, { month: readText(formData, "month"), ...values }),
  );
}

export async function setCommissionRateAction(_previous: FormState, formData: FormData) {
  const values = { ratePerKg: readText(formData, "ratePerKg") };
  return run("Ставку збережено.", values, (actor) =>
    setCommissionRate(getDb(), actor, {
      month: readText(formData, "month"),
      profileId: readText(formData, "profileId"),
      ...values,
    }),
  );
}

export async function addCategoryAction(_previous: FormState, formData: FormData) {
  const values = { name: readText(formData, "name"), kind: readText(formData, "kind") };
  return run("Статтю додано.", values, (actor) =>
    addCategory(getDb(), actor, {
      name: values.name,
      kind: values.kind as "expense" | "income",
      repeatsMonthly: readFlag(formData, "repeatsMonthly"),
    }),
  );
}

export async function updateCategoryAction(_previous: FormState, formData: FormData) {
  return run("Статтю збережено.", {}, (actor) =>
    updateCategory(getDb(), actor, {
      id: readText(formData, "id"),
      repeatsMonthly: readFlag(formData, "repeatsMonthly"),
      isActive: readFlag(formData, "isActive"),
    }),
  );
}

export async function closeMonthAction(_previous: FormState, formData: FormData) {
  return run("Місяць закрито.", {}, (actor) =>
    closeMonth(getDb(), actor, { month: readText(formData, "month") }),
  );
}

export async function reopenMonthAction(_previous: FormState, formData: FormData) {
  return run("Місяць відкрито.", {}, (actor) =>
    reopenMonth(getDb(), actor, { month: readText(formData, "month") }),
  );
}
