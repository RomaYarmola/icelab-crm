"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction } from "@/server/form-state";
import { changeDefaultPrice } from "@/server/prices";
import type { FormState } from "@/utils/formState";

/** Зміна прайсу (цін за замовчуванням) «від дати»: лише власник, права перевіряє `changeDefaultPrice`. */
export async function changeDefaultPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    iceTypeId: readText(formData, "iceTypeId"),
    pricePerKg: readText(formData, "pricePerKg"),
    validFrom: readText(formData, "validFrom"),
  };
  return runFormAction(
    async () => {
      const iceTypeId = z.uuid().safeParse(values.iceTypeId);
      if (!iceTypeId.success) throw new ValidationError("Оберіть тип льоду.");
      await changeDefaultPrice(getDb(), actor, {
        iceTypeId: iceTypeId.data,
        pricePerKg: values.pricePerKg,
        validFrom: values.validFrom,
      });
      revalidatePath("/more/prices");
      revalidatePath("/clients", "layout");
    },
    { success: "Нову ціну збережено.", values },
  );
}
