import type { ShipmentStepResult } from "@/app/(app)/shipments/actions";

/** Дії екрана «ТТН на день»: екран отримує їх готовими (у каталозі `/ui-kit` це заглушка). */
export interface ShipmentDayActions {
  createStep: (orderId: string) => Promise<ShipmentStepResult>;
}
