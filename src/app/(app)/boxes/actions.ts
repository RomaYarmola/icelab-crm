"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { addLegacyDebt, resolveLegacyDebt } from "@/server/box-debts";
import { createBoxes, markLabelsPrinted, recordBoxEvent } from "@/server/boxes";
import { readText, runFormAction } from "@/server/form-state";
import type { FormState } from "@/utils/formState";

/**
 * Дії реєстру боксів (B9): створити партію й позначити наклейки надрукованими. Права й правила
 * перевіряють серверні функції, тут лише читаємо поля форми.
 */

/** «Згенерувати бокси»: тип, кількість, локація. Коди повертаємо в `values.codes` для PDF. */
export async function createBoxesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    boxTypeId: readText(formData, "boxTypeId"),
    count: readText(formData, "count"),
    locationId: readText(formData, "locationId"),
  };
  let codes: string[] = [];
  const state = await runFormAction(
    async () => {
      const created = await createBoxes(getDb(), actor, {
        boxTypeId: values.boxTypeId,
        locationId: actor.locationId ?? values.locationId,
        count: Number(values.count),
      });
      codes = created.codes;
      revalidatePath("/boxes");
    },
    { success: "Бокси створено.", values },
  );
  if (state.status !== "success") return state;
  const label = codes.length === 1 ? codes[0]! : `${codes[0]} … ${codes.at(-1)}`;
  return {
    ...state,
    message: `Створено ${codes.length}: ${label}.`,
    values: { codes: codes.join(",") },
  };
}

/** «Позначити надрукованими» після друку. */
export async function markPrintedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const codes = readText(formData, "codes").split(",").filter(Boolean);
  return runFormAction(
    async () => {
      await markLabelsPrinted(getDb(), actor, codes);
      revalidatePath("/boxes");
    },
    { success: "Позначено надрукованими.", values: { codes: codes.join(",") } },
  );
}

/** «Додати борг за таблицею» (D114): клієнт, тип, кількість, з якого дня. */
export async function addLegacyDebtAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    clientId: readText(formData, "clientId"),
    boxTypeId: readText(formData, "boxTypeId"),
    count: readText(formData, "count"),
    sinceDate: readText(formData, "sinceDate"),
    note: readText(formData, "note"),
  };
  return runFormAction(
    async () => {
      await addLegacyDebt(getDb(), actor, {
        clientId: values.clientId,
        boxTypeId: values.boxTypeId,
        count: Number(values.count),
        sinceDate: values.sinceDate || null,
        note: values.note.trim() || null,
      });
      revalidatePath("/boxes/debts");
      revalidatePath(`/clients/${values.clientId}`);
    },
    { success: "Борг додано.", values: values.clientId ? values : {} },
  );
}

/** «Закрити N шт.» у старому боргу: клієнт повернув бокси без наклейки. */
export async function resolveLegacyDebtAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const id = readText(formData, "id");
  const count = readText(formData, "count");
  return runFormAction(
    async () => {
      await resolveLegacyDebt(getDb(), actor, { id, count: Number(count) });
      revalidatePath("/boxes/debts");
      revalidatePath("/clients", "layout");
    },
    { success: "Закрито.", values: { id, count } },
  );
}

/** «Перемістити в іншу локацію» на картці бокса (лише власник, бокс «На складі»). */
export async function transferBoxAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const code = readText(formData, "code");
  const toLocationId = readText(formData, "toLocationId");
  return runFormAction(
    async () => {
      await recordBoxEvent(getDb(), actor, { code, action: "transfer", toLocationId });
      revalidatePath(`/boxes/${code}`);
      revalidatePath("/boxes", "layout");
    },
    { success: "Бокс переміщено.", values: { toLocationId } },
  );
}
