"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { readText, runFormAction } from "@/server/form-state";
import {
  cancelTopicCapture,
  checkTelegramConnection,
  connectTelegramWebhook,
  createLinkCode,
  startTopicCapture,
  unlinkTelegram,
} from "@/server/telegram/admin";
import { ValidationError } from "@/server/errors";
import type { FormState } from "@/utils/formState";

/**
 * Дії екрана «Прийом заявок» (B11). Права й перевірки робить `server/telegram/admin.ts`; тут лише
 * читаємо поля й повертаємо повідомлення для екрана.
 */

/** Адреса застосунку, на якому зараз відкрито екран (для webhook): лише https. */
async function currentBaseUrl(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const proto = list.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function withMessage(task: () => Promise<string>): Promise<FormState> {
  let message = "";
  const state = await runFormAction(
    async () => {
      message = await task();
      revalidatePath("/intake");
    },
    { success: "" },
  );
  return state.status === "error" ? state : { status: "success", message };
}

/** «Перевірити з'єднання» з Telegram. */
export async function checkTelegramAction(): Promise<FormState> {
  const actor = await requireUser();
  const base = await currentBaseUrl();
  let ok = true;
  const state = await withMessage(async () => {
    const result = await checkTelegramConnection(getDb(), actor, `${base}/api/telegram/webhook`);
    ok = result.ok;
    return result.message;
  });
  return state.status === "success" && !ok ? { status: "error", message: state.message } : state;
}

/** «Підключити бота до цієї адреси». */
export async function connectWebhookAction(): Promise<FormState> {
  const actor = await requireUser();
  const base = await currentBaseUrl();
  return withMessage(async () => {
    const url = await connectTelegramWebhook(getDb(), actor, base);
    return `Бота підключено: Telegram надсилатиме події на ${url}.`;
  });
}

/** «Визначити топік»: `target` = `kyiv` чи `lviv`. */
export async function startCaptureAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const target = readText(formData, "target");
  return withMessage(async () => {
    if (target !== "kyiv" && target !== "lviv") throw new ValidationError("Оберіть топік.");
    await startTopicCapture(getDb(), actor, target);
    return "Тепер напишіть будь-яке повідомлення в цьому топіку групи (протягом 10 хвилин). Бот його запам'ятає.";
  });
}

export async function cancelCaptureAction(): Promise<FormState> {
  const actor = await requireUser();
  return withMessage(async () => {
    await cancelTopicCapture(getDb(), actor);
    return "Скасовано.";
  });
}

/** «Створити код»: код прив'язки Telegram для користувача. */
export async function createCodeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const profileId = readText(formData, "profileId");
  return withMessage(async () => {
    const result = await createLinkCode(getDb(), actor, profileId);
    const link = result.link ? ` Або відкрийте посилання: ${result.link}` : "";
    return `Код: ${result.code}. Нехай користувач надішле боту в Telegram: /start ${result.code}.${link} Код діє 24 години.`;
  });
}

export async function unlinkAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  const profileId = readText(formData, "profileId");
  return withMessage(async () => {
    await unlinkTelegram(getDb(), actor, profileId);
    return "Telegram відв'язано.";
  });
}
