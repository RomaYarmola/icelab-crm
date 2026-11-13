import type { FormAction } from "../clientsPage/clientActions";

/** Дії екрана «Готівка». Збираються на сторінці (у каталозі `/ui-kit` це заглушки). */
export interface CashActions {
  /** «Прийнято готівку»: запис суми по замовленню. */
  record: FormAction;
  /** Сторно запису (лише власник). */
  reverse: FormAction;
}
