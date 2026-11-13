"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readOptionalText, readText, runFormAction } from "@/server/form-state";
import { updateOrder } from "@/server/orders";
import { autoStartProduction, markOrdersSeen } from "@/server/production";
import { notifyOrderChange, notifyProductionChange } from "@/server/production-signal";
import type { FormState } from "@/utils/formState";
import { todayIso } from "@/utils/isoDate";

/**
 * Дії екрана виробництва (B6). Кнопки «Розпочати», «Готово» і «Повернути в роботу» це звичайний
 * перехід статусу (`transitionOrderAction` з розділу замовлень). Тут лише те, що робить сам екран:
 * автозапуск замовлень на сьогодні (D72), «Нове» → побачене (D65) і правка «виготовити» та
 * коментаря старшим локації.
 */

export type ProductionOpenResult =
  { status: "ok"; started: number; marked: number } | { status: "error"; message: string };

const idList = z.array(z.uuid()).max(500);

function refresh() {
  revalidatePath("/production", "layout");
}

/**
 * Екран відкрито: замовлення на сьогодні переходять у «У виробництві» (D72), а показані «нові»
 * позначаються побаченими (D65). Робить лише цех чи старший локації; для інших ролей дія нічого не
 * змінює. Повертає, скільки замовлень запущено й позначено. Екран викликає її після першого показу.
 */
export async function openProductionScreenAction(input: {
  date: string;
  seenOrderIds: string[];
}): Promise<ProductionOpenResult> {
  const actor = await requireUser();
  if (actor.role !== "production" && actor.role !== "location_lead") {
    return { status: "ok", started: 0, marked: 0 };
  }
  try {
    const ids = idList.safeParse(input.seenOrderIds);
    if (!ids.success) throw new ValidationError("Не вдалося прочитати список замовлень.");
    const today = todayIso();
    const started =
      input.date === today ? await autoStartProduction(getDb(), actor, today) : { started: 0 };
    const marked = await markOrdersSeen(getDb(), actor, {
      date: input.date,
      orderIds: ids.data,
    });
    if (started.started > 0 || marked.marked > 0) refresh();
    // Інші відкриті екрани цієї локації мають побачити, що замовлення вже розпочато.
    if (started.started > 0 && actor.locationId) notifyProductionChange([actor.locationId]);
    return { status: "ok", started: started.started, marked: marked.marked };
  } catch (error) {
    if (error instanceof ValidationError) return { status: "error", message: error.message };
    throw error;
  }
}

/** Кнопка «Позначити всі побаченими»: знімає «Нове» з усіх замовлень дня своєї локації. */
export async function markAllSeenAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const date = readText(formData, "date");
  return runFormAction(
    async () => {
      await markOrdersSeen(getDb(), actor, { date });
      refresh();
      if (actor.locationId) notifyProductionChange([actor.locationId]);
    },
    { success: "Усі замовлення позначено побаченими." },
  );
}

/**
 * Старший локації міняє «виготовити» (кг) і коментар для виробництва прямо з екрана цеху. Права й
 * стан замовлення перевіряє `updateOrder` (D58): лише після підтвердження, до відправлення.
 */
export async function updateProductionOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    kgToProduce: readText(formData, "kgToProduce"),
    comment: readText(formData, "comment"),
  };
  return runFormAction(
    async () => {
      const id = z.uuid().safeParse(readText(formData, "id"));
      if (!id.success) throw new ValidationError("Замовлення не знайдено.");
      const patch: Record<string, unknown> = {};
      if (formData.has("kgToProduce")) {
        const kg = readOptionalText(formData, "kgToProduce");
        if (kg === null) throw new ValidationError("Вкажіть, скільки кілограмів виготовити.");
        patch.kgToProduce = kg;
      }
      if (formData.has("comment")) patch.comment = readOptionalText(formData, "comment");
      await updateOrder(getDb(), actor, id.data, patch);
      refresh();
      revalidatePath("/orders", "layout");
      notifyOrderChange(getDb(), id.data);
    },
    { success: "Зміни збережено.", values },
  );
}
