"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readFlag, readText, runFormAction } from "@/server/form-state";
import { changeDefaultPrice } from "@/server/prices";
import { changeBoxPrice, changeProductPrice } from "@/server/product-prices";
import { createProduct, updateProduct } from "@/server/products";
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
      revalidatePath("/prices");
      revalidatePath("/clients", "layout");
    },
    { success: "Нову ціну збережено.", values },
  );
}

/** Зміна ціни боксів на продаж «від дати» (D175): лише власник, права перевіряє `changeBoxPrice`. */
export async function changeBoxPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    boxTypeId: readText(formData, "boxTypeId"),
    pricePerUnit: readText(formData, "pricePerUnit"),
    validFrom: readText(formData, "validFrom"),
  };
  return runFormAction(
    async () => {
      await changeBoxPrice(getDb(), actor, values);
      revalidatePath("/prices");
      revalidatePath("/orders", "layout");
    },
    { success: "Нову ціну збережено.", values },
  );
}

/** Зміна ціни товару без типів (рідкий азот) «від дати» (D176): лише власник. */
export async function changeProductPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    productCode: readText(formData, "productCode"),
    pricePerUnit: readText(formData, "pricePerUnit"),
    validFrom: readText(formData, "validFrom"),
  };
  return runFormAction(
    async () => {
      await changeProductPrice(getDb(), actor, values);
      revalidatePath("/prices");
      revalidatePath("/orders", "layout");
    },
    { success: "Нову ціну збережено.", values },
  );
}

/** Спосіб(и) доставки з прапорців форми товару. */
function readMethods(formData: FormData): string[] {
  return formData.getAll("deliveryMethod").map(String);
}

/** Новий товар без типів (D174): назва, одиниця, чи виробляє цех, дозволена доставка. Лише власник. */
export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { name: readText(formData, "name"), unit: readText(formData, "unit") };
  return runFormAction(
    async () => {
      await createProduct(getDb(), actor, {
        ...values,
        unit: values.unit as "кг" | "шт",
        producedByWorkshop: readFlag(formData, "producedByWorkshop"),
        deliveryMethods: readMethods(formData) as ("pickup" | "our_delivery" | "np")[],
      });
      revalidatePath("/prices");
      revalidatePath("/orders", "layout");
    },
    { success: "Товар додано. Тепер вкажіть його ціну в блоці вище.", values },
  );
}

/** Зміна товару (назва, цех, доставка, активність). Лише власник. */
export async function updateProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { name: readText(formData, "name") };
  return runFormAction(
    async () => {
      await updateProduct(getDb(), actor, readText(formData, "id"), {
        name: values.name,
        producedByWorkshop: readFlag(formData, "producedByWorkshop"),
        deliveryMethods: readMethods(formData) as ("pickup" | "our_delivery" | "np")[],
        isActive: readFlag(formData, "isActive"),
      });
      revalidatePath("/prices");
      revalidatePath("/orders", "layout");
    },
    { success: "Товар збережено.", values },
  );
}
