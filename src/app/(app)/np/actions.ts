"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { ForbiddenError, requirePermission } from "@/server/guards";
import { readText, runFormAction } from "@/server/form-state";
import { autoResolveAddresses } from "@/server/np/addresses";
import { NpError } from "@/server/np/client";
import { type SyncResult, syncDirectoriesNow } from "@/server/np/directories";
import { trackShipments } from "@/server/np/tracking";
import {
  checkNpConnection,
  listNpSenderDetails,
  listNpSenders,
  saveLocationSender,
  setBoxTypeEmptyWeight,
  type NpOption,
} from "@/server/np/settings";
import type { FormState } from "@/utils/formState";

/**
 * Дії екрана «Нова Пошта» (B10). Права й перевірки робить `server/np/settings.ts`, тут лише
 * читаємо поля форми й перетворюємо помилки Нової Пошти на текст для екрана.
 */

/** «Перевірити з'єднання»: результат (успіх чи текст помилки) показуємо на екрані. */
export async function checkConnectionAction(): Promise<FormState> {
  const actor = await requireUser();
  let message = "";
  let ok = false;
  const state = await runFormAction(
    async () => {
      const result = await checkNpConnection(getDb(), actor);
      message = result.message;
      ok = result.ok;
      revalidatePath("/np");
    },
    { success: "" },
  );
  if (state.status === "error") return state;
  return { status: ok ? "success" : "error", message };
}

export type NpLoadResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function load<T>(task: () => Promise<T>): Promise<NpLoadResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    if (error instanceof NpError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/** Відправники з акаунта Нової Пошти для вибору. */
export async function loadSendersAction(): Promise<NpLoadResult<NpOption[]>> {
  const actor = await requireUser();
  return load(() => listNpSenders(getDb(), actor));
}

/** Контактні особи й адреси вибраного відправника. */
export async function loadSenderDetailsAction(
  senderRef: string,
): Promise<NpLoadResult<{ contacts: NpOption[]; addresses: NpOption[] }>> {
  const actor = await requireUser();
  return load(() => listNpSenderDetails(getDb(), actor, senderRef));
}

/** Зберігає відправника локації. */
export async function saveSenderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = {
    locationId: readText(formData, "locationId"),
    phone: readText(formData, "phone"),
  };
  return runFormAction(
    async () => {
      await saveLocationSender(getDb(), actor, {
        locationId: values.locationId,
        senderRef: readText(formData, "senderRef"),
        contactRef: readText(formData, "contactRef"),
        addressRef: readText(formData, "addressRef"),
        cityRef: readText(formData, "addressCityRef"),
        phone: values.phone.trim(),
        senderName: readText(formData, "senderName"),
        contactName: readText(formData, "contactName"),
        addressName: readText(formData, "addressName"),
      });
      revalidatePath("/np");
    },
    { success: "Відправника збережено.", values },
  );
}

/** Зберігає вагу порожнього бокса (порожнє поле знімає вагу). */
export async function saveEmptyWeightAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const boxTypeId = readText(formData, "boxTypeId");
  const weightKg = readText(formData, "weightKg");
  return runFormAction(
    async () => {
      await setBoxTypeEmptyWeight(getDb(), actor, { boxTypeId, weightKg });
      revalidatePath("/np");
    },
    { success: "Збережено.", values: { weightKg } },
  );
}

export type NpSyncStep = { ok: true; result: SyncResult } | { ok: false; message: string };

/**
 * «Оновити зараз»: один крок оновлення довідників. Екран викликає його знову й знову, поки не
 * прийде `done`, і показує прогрес: так кожен запит вкладається в ліміт часу функції.
 */
export async function syncDirectoriesAction(): Promise<NpSyncStep> {
  const actor = await requireUser();
  try {
    const result = await syncDirectoriesNow(getDb(), actor);
    revalidatePath("/np");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof NpError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/** «Зіставити автоматично»: однозначні адреси клієнтів зіставляються з довідником. */
export async function autoResolveAction(): Promise<FormState> {
  const actor = await requireUser();
  let message = "";
  const state = await runFormAction(
    async () => {
      const result = await autoResolveAddresses(getDb(), actor);
      message =
        result.checked === 0
          ? "Адрес, що чекають зіставлення, немає."
          : `Перевірено ${result.checked}: зіставлено ${result.resolved}, лишилось для ручного підбору ${result.needsReview}.`;
      revalidatePath("/np");
    },
    { success: "" },
  );
  return state.status === "error" ? state : { status: "success", message };
}

/** «Оновити статуси зараз»: трекінг усіх незавершених накладних без очікування розкладу. Лише власник. */
export async function trackAllAction(): Promise<FormState> {
  const actor = await requireUser();
  let message = "";
  const state = await runFormAction(
    async () => {
      requirePermission(actor, "migration_settings", "write");
      try {
        const result = await trackShipments(getDb());
        message = result.message;
      } catch (error) {
        if (error instanceof NpError) throw new ValidationError(error.message);
        throw error;
      }
      revalidatePath("/np");
    },
    { success: "" },
  );
  return state.status === "error" ? state : { status: "success", message };
}
