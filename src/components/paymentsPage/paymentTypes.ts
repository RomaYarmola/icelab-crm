import type { ImportActionResult } from "@/app/(app)/payments/actions";
import type { ImportPreview, ImportResult } from "@/server/statement-import";
import type { FormAction } from "../clientsPage/clientActions";

/** Дії екрана «Оплати»: екран отримує їх готовими (у каталозі `/ui-kit` це заглушки). */
export interface PaymentActions {
  sync: FormAction;
  match: FormAction;
  ignore: FormAction;
  restore: FormAction;
  unmatch: FormAction;
  byNumbers: FormAction;
  selected: FormAction;
  requisites: FormAction;
  importPreview: (formData: FormData) => Promise<ImportActionResult<ImportPreview>>;
  importCommit: (formData: FormData) => Promise<ImportActionResult<ImportResult>>;
}
