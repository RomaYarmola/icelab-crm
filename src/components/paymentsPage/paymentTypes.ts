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
}
