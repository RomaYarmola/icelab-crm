"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { orders } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import { syncMonobankNow } from "@/server/monobank/status";
import {
  ignorePayment,
  matchPaymentManually,
  restorePayment,
  unmatchPayment,
} from "@/server/payments";
import type { FormState } from "@/utils/formState";

/** «Перевірити з'єднання й забрати виписку» (B13). Права перевіряє `syncMonobankNow`. */
export async function syncMonobankAction(): Promise<FormState> {
  const actor = await requireUser();
  let message = "";
  const state = await runFormAction(
    async () => {
      message = await syncMonobankNow(getDb(), actor);
      revalidatePath("/payments");
    },
    { success: "" },
  );
  if (state.status === "error") return state;
  // Помилки банку повертаємо як помилку, успіх як успіх.
  return /^З'єднання працює/.test(message)
    ? { status: "success", message }
    : { status: "error", message };
}

function refresh() {
  revalidatePath("/payments");
  revalidatePath("/orders", "layout");
}

const readId = (formData: FormData, name: string, message: string): string => {
  const parsed = z.uuid().safeParse(readText(formData, name));
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data;
};

/**
 * Зіставити платіж із замовленням: або `orderId` (кнопка підказки), або `orderNumber` (ручний
 * ввід), і сума. Платіж із залишком лишається в черзі, тож його можна розкласти на кілька замовлень.
 */
export async function matchPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    orderNumber: readText(formData, "orderNumber"),
    amount: readText(formData, "amount"),
  };
  return runFormAction(
    async () => {
      const db = getDb();
      let orderId = readText(formData, "orderId");
      if (!orderId) {
        const number = Number(values.orderNumber.replace(/[^\d]/g, ""));
        if (!Number.isInteger(number) || number <= 0) {
          throw new ValidationError("Вкажіть номер замовлення цифрами.");
        }
        const [order] = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.number, number), isNull(orders.deletedAt)));
        if (!order) throw new ValidationError(`Замовлення №${number} не знайдено.`);
        orderId = order.id;
      }
      await matchPaymentManually(db, actor, readId(formData, "paymentId", "Платіж не знайдено."), [
        { orderId, amount: values.amount },
      ]);
      refresh();
    },
    { success: "Платіж зіставлено.", values },
  );
}

/** «Ігнорувати» платіж із причиною. */
export async function ignorePaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { reason: readText(formData, "reason") };
  return runFormAction(
    async () => {
      await ignorePayment(
        getDb(),
        actor,
        readId(formData, "paymentId", "Платіж не знайдено."),
        values.reason,
      );
      refresh();
    },
    { success: "Платіж ігноровано.", values },
  );
}

/** Повернути ігнорований платіж у чергу. */
export async function restorePaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await restorePayment(getDb(), actor, readId(formData, "paymentId", "Платіж не знайдено."));
      refresh();
    },
    { success: "Платіж повернуто в чергу." },
  );
}

/** Скасувати зіставлення платежу (лише власник, з причиною). */
export async function unmatchPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { reason: readText(formData, "reason") };
  return runFormAction(
    async () => {
      await unmatchPayment(
        getDb(),
        actor,
        readId(formData, "paymentId", "Платіж не знайдено."),
        values.reason,
      );
      refresh();
    },
    { success: "Зіставлення скасовано.", values },
  );
}
