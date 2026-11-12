import { unstable_rethrow } from "next/navigation";
import type { FormState } from "@/utils/formState";
import { ValidationError } from "./errors";
import { reportError } from "./error-log";
import { ForbiddenError } from "./guards";

/** Текстове поле форми (порожній рядок, якщо поля немає або воно не текстове). */
export function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Повідомлення про непередбачену помилку: подробиці користувачу не показуємо. */
export const UNEXPECTED_ERROR_MESSAGE = "Щось пішло не так. Спробуйте ще раз.";

/**
 * Виконує дію форми і перетворює результат на `FormState`. Помилки введення й відмови за правами
 * показуємо як є (вони українською), решту ховаємо за загальним повідомленням і пишемо в журнал
 * помилок (`reportError`). Службові помилки Next.js (`redirect`, `notFound`) пропускаємо далі.
 */
export async function runFormAction(
  task: () => Promise<void>,
  options: { success: string; values?: Record<string, string> },
): Promise<FormState> {
  try {
    await task();
    return { status: "success", message: options.success };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ValidationError) {
      return { status: "error", message: error.message, values: options.values };
    }
    if (error instanceof ForbiddenError) {
      return { status: "error", message: error.message };
    }
    await reportError({ source: "form_action", error });
    return { status: "error", message: UNEXPECTED_ERROR_MESSAGE, values: options.values };
  }
}
