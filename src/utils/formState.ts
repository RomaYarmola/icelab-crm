/**
 * Стан форми на серверній дії (`useActionState`): що показати після відправки. Лежить у спільних
 * утилітах, бо потрібен і серверу (`server/form-state.ts`), і екранам; файл із "use server" може
 * віддавати лише асинхронні функції.
 */
export type FormState = {
  status: "idle" | "success" | "error";
  /** Повідомлення українською для екрана. */
  message?: string;
  /**
   * Введені значення, які повертаємо при помилці: React очищає поля форми після дії, а вводити все
   * заново через одну помилку незручно.
   */
  values?: Record<string, string>;
};

export const INITIAL_FORM_STATE: FormState = { status: "idle" };
