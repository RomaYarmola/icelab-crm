import type { ProductionOpenResult } from "@/app/(app)/production/actions";
import type { FormAction } from "../clientsPage/clientActions";

/** Усі дії екрана виробництва. Збираються на сторінці (у каталозі `/ui-kit` це заглушки). */
export interface ProductionActions {
  /** Перехід статусу: «Розпочати», «Готово», «Повернути в роботу». */
  transition: FormAction;
  /** Старший локації міняє «виготовити» і коментар. */
  updateOrder: FormAction;
  markAllSeen: FormAction;
  /** Екран відкрито: автозапуск на сьогодні й «Нове» → побачене. */
  openScreen: (input: { date: string; seenOrderIds: string[] }) => Promise<ProductionOpenResult>;
}

export type { ProductionOpenResult };
