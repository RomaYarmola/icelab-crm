"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { reportError } from "@/server/error-log";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { NpError } from "@/server/np/client";
import { createShipment } from "@/server/np/shipments";

/** Результат створення ТТН для одного замовлення в черзі масового створення. */
export type ShipmentStepResult =
  | { ok: true; orderId: string; shipmentId: string; ttnNumber: string; duplicate: boolean }
  | { ok: false; orderId: string; message: string };

/**
 * Створює ТТН для одного замовлення (D124): екран «ТТН на день» викликає це по черзі, не більше двох
 * замовлень одночасно, тож один запит завжди короткий. Помилка одного замовлення (текст Нової
 * Пошти) повертається як результат і не зупиняє решту. Платник одержувач, як і в ТЗ за замовчуванням.
 */
export async function createShipmentStepAction(orderId: string): Promise<ShipmentStepResult> {
  const actor = await requireUser();
  try {
    const result = await createShipment(getDb(), actor, { orderId, payer: "Recipient" });
    revalidatePath(`/orders/${orderId}`);
    return {
      ok: true,
      orderId,
      shipmentId: result.id,
      ttnNumber: result.ttnNumber,
      duplicate: result.duplicate,
    };
  } catch (error) {
    if (
      error instanceof NpError ||
      error instanceof ValidationError ||
      error instanceof ForbiddenError
    ) {
      return { ok: false, orderId, message: error.message };
    }
    await reportError({ source: "form_action", error });
    return { ok: false, orderId, message: "Щось пішло не так. Спробуйте ще раз." };
  }
}
