"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { createBoxes, markLabelsPrinted, sellBoxToOrder } from "@/server/boxes";
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

/** «Продати бокс» на картці замовлення (D108): бокс «Продано» і позиція в замовленні. */
export async function sellBoxAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const values = { code: readText(formData, "code") };
  const orderId = readText(formData, "orderId");
  return runFormAction(
    async () => {
      await sellBoxToOrder(getDb(), actor, { orderId, code: values.code });
      revalidatePath(`/orders/${orderId}`);
      revalidatePath("/boxes");
    },
    {
      success: "Бокс продано, позицію додано в замовлення. Перевірте ціну в позиціях.",
      values: {},
    },
  );
}
