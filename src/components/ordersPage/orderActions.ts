import type { FormAction } from "../clientsPage/clientActions";

/** Дії картки замовлення. Збираються на сторінці з `app/(app)/orders/actions` (у каталозі `/ui-kit` це заглушки). */
export interface OrderCardActions {
  transition: FormAction;
  changePrice: FormAction;
  remove: FormAction;
}
