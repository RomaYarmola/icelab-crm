"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { orders } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction, UNEXPECTED_ERROR_MESSAGE } from "@/server/form-state";
import { syncMonobankNow } from "@/server/monobank/status";
import { reportError } from "@/server/error-log";
import { ForbiddenError } from "@/server/guards";
import { createPaymentLinks, setPaymentLinkAccount } from "@/server/payment-links";
import { setRequisites } from "@/server/payment-views";
import { type ColumnMapping, MAPPING_FIELDS, StatementFileError } from "@/server/statement-file";
import {
  commitStatementImport,
  type ImportPreview,
  type ImportResult,
  previewStatementImport,
} from "@/server/statement-import";
import {
  ignorePayment,
  matchPaymentByNumbers,
  matchPaymentManually,
  matchPaymentToOrders,
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

/** «Погасити за номерами з призначення» (D198): названі замовлення гасяться у порядку номерів. */
export async function matchByNumbersAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await matchPaymentByNumbers(
        getDb(),
        actor,
        readId(formData, "paymentId", "Платіж не знайдено."),
      );
      refresh();
    },
    { success: "Платіж погашено за номерами з призначення." },
  );
}

/** Платіж без номерів: гасимо замовлення, які бухгалтер відзначив у списку клієнта. */
export async function matchSelectedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      const ids = formData
        .getAll("orderId")
        .filter((value): value is string => typeof value === "string");
      await matchPaymentToOrders(
        getDb(),
        actor,
        readId(formData, "paymentId", "Платіж не знайдено."),
        ids,
      );
      refresh();
    },
    { success: "Платіж зіставлено з вибраними замовленнями." },
  );
}

/** Реквізити для повідомлення клієнтові (порожній текст прибирає їх). */
export async function saveRequisitesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = { requisites: readText(formData, "requisites") };
  return runFormAction(
    async () => {
      await setRequisites(getDb(), actor, values.requisites);
      refresh();
    },
    { success: "Реквізити збережено.", values },
  );
}

export async function saveLinkAccountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await setPaymentLinkAccount(getDb(), actor, readText(formData, "accountUid"));
      refresh();
    },
    { success: "Рахунок для посилань збережено." },
  );
}

export type PaymentLinksResult = { links: Record<string, string>; error: string | null };

/** Посилання на оплату відзначених замовлень (D239). Права й суми перевіряє сервер. */
export async function createPaymentLinksAction(input: {
  clientId: string;
  orderIds: string[];
}): Promise<PaymentLinksResult> {
  const actor = await requireUser();
  try {
    return await createPaymentLinks(getDb(), actor, input);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      return { links: {}, error: error.message };
    }
    await reportError({ source: "form_action", error });
    return { links: {}, error: UNEXPECTED_ERROR_MESSAGE };
  }
}

export type ImportActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Файл і (за потреби) вибір колонок із форми завантаження. */
function readImportForm(formData: FormData): {
  file: { name: string; bytes: Uint8Array };
  mapping: ColumnMapping | null;
} {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError("Оберіть файл виписки.");
  }
  let mapping: ColumnMapping | null = null;
  const raw = formData.get("mapping");
  if (typeof raw === "string" && raw !== "") {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    mapping = Object.fromEntries(
      MAPPING_FIELDS.map((field) => [
        field,
        typeof parsed[field] === "string" && parsed[field] !== ""
          ? (parsed[field] as string)
          : null,
      ]),
    ) as ColumnMapping;
  }
  return { file: { name: file.name, bytes: new Uint8Array(0) }, mapping };
}

async function withFile<T>(
  formData: FormData,
  run: (file: { name: string; bytes: Uint8Array }, mapping: ColumnMapping | null) => Promise<T>,
): Promise<ImportActionResult<T>> {
  try {
    const { file, mapping } = readImportForm(formData);
    const source = formData.get("file") as File;
    const bytes = new Uint8Array(await source.arrayBuffer());
    return { ok: true, data: await run({ name: file.name, bytes }, mapping) };
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof StatementFileError ||
      error instanceof ForbiddenError
    ) {
      return { ok: false, error: error.message };
    }
    if (error instanceof SyntaxError) return { ok: false, error: "Некоректний вибір колонок." };
    throw error;
  }
}

/** Попередній перегляд файла виписки: нічого не записує. */
export async function previewImportAction(
  formData: FormData,
): Promise<ImportActionResult<ImportPreview>> {
  const actor = await requireUser();
  return withFile(formData, (file, mapping) =>
    previewStatementImport(getDb(), actor, file, mapping),
  );
}

/** Імпорт файла виписки з вибраними колонками. */
export async function commitImportAction(
  formData: FormData,
): Promise<ImportActionResult<ImportResult>> {
  const actor = await requireUser();
  const result = await withFile(formData, (file, mapping) => {
    if (!mapping) throw new ValidationError("Вкажіть колонки.");
    return commitStatementImport(getDb(), actor, file, mapping);
  });
  if (result.ok) refresh();
  return result;
}
