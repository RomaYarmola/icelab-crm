"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import { NpError } from "@/server/np/client";
import {
  createShipment,
  deleteShipment,
  type NpPayerValue,
  previewShipmentPrice,
} from "@/server/np/shipments";
import type { FormState } from "@/utils/formState";

/**
 * Дії блока «Нова Пошта» на картці замовлення (B10, PR 3). Права й правила перевіряють серверні
 * функції; тут лише читаємо поля й перетворюємо помилки Нової Пошти на текст для екрана.
 */

/** Помилка Нової Пошти стає звичайною помилкою введення: текст українською вже готовий. */
async function userFacing<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof NpError) throw new ValidationError(error.message);
    throw error;
  }
}

const payerOf = (formData: FormData): NpPayerValue =>
  readText(formData, "payer") === "Sender" ? "Sender" : "Recipient";

/** «Створити ТТН». */
export async function createShipmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const orderId = readText(formData, "orderId");
  let ttn = "";
  const state = await runFormAction(
    async () => {
      const result = await userFacing(() =>
        createShipment(getDb(), actor, { orderId, payer: payerOf(formData) }),
      );
      ttn = result.ttnNumber;
      revalidatePath(`/orders/${orderId}`);
    },
    { success: "" },
  );
  if (state.status === "error") {
    revalidatePath(`/orders/${orderId}`);
    return state;
  }
  return { status: "success", message: `ТТН створено: ${ttn}.` };
}

/** «Порахувати вартість» до створення (лише ролі, що бачать гроші замовлення). */
export async function previewShipmentPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const orderId = readText(formData, "orderId");
  let cost = 0;
  const state = await runFormAction(
    async () => {
      const result = await userFacing(() =>
        previewShipmentPrice(getDb(), actor, { orderId, payer: payerOf(formData) }),
      );
      cost = result.costUah;
    },
    { success: "" },
  );
  if (state.status === "error") return state;
  return {
    status: "success",
    message: `Вартість доставки: ${cost.toLocaleString("uk-UA")} ₴.`,
  };
}

/** «Видалити ТТН» (до передачі у відділення). */
export async function deleteShipmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const orderId = readText(formData, "id");
  return runFormAction(
    async () => {
      await userFacing(() => deleteShipment(getDb(), actor, orderId));
      revalidatePath(`/orders/${orderId}`);
    },
    { success: "ТТН видалено." },
  );
}
