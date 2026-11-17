import type { FormAction } from "../clientsPage/clientActions";

/** Дії екрана «Прийом заявок»: екран отримує їх готовими (у каталозі `/ui-kit` це заглушки). */
export interface IntakeActions {
  check: FormAction;
  connect: FormAction;
  startCapture: FormAction;
  cancelCapture: FormAction;
  createCode: FormAction;
  unlink: FormAction;
}
