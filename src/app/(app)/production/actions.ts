"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import { autoStartProduction, markOrdersSeen } from "@/server/production";
import type { FormState } from "@/utils/formState";
import { todayIso } from "@/utils/isoDate";

/**
 * Дії екрана виробництва (B6). Кнопки «Розпочати», «Готово» і «Повернути в роботу» це звичайний
 * перехід статусу (`transitionOrderAction` з розділу замовлень). Тут лише те, що робить сам екран:
 * автозапуск замовлень на сьогодні (D72) і «Нове» → побачене (D65).
 */

export type ProductionOpenResult =
  { status: "ok"; started: number; marked: number } | { status: "error"; message: string };

const idList = z.array(z.uuid()).max(500);

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
    if (started.started > 0 || marked.marked > 0) revalidatePath("/production", "layout");
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
      revalidatePath("/production", "layout");
    },
    { success: "Усі замовлення позначено побаченими." },
  );
}
