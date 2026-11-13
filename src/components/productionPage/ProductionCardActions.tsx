"use client";

import { PRODUCTION_BUTTON_LABELS } from "@/constants/production";
import type { OrderStatus } from "@/constants/constants";
import type { FormAction } from "../clientsPage/clientActions";
import OrderTransitionForm from "../ordersPage/OrderTransitionForm";

interface ProductionCardActionsProps {
  orderId: string;
  status: OrderStatus;
  /** Старший локації може ще й повернути запаковане в роботу (D73). */
  canReturn: boolean;
  action: FormAction;
}

/**
 * Кнопки картки цеху: «Розпочати» (підтверджене), «Готово» (у виробництві) на всю ширину, для
 * запакованого «Повернути в роботу» з причиною (лише старший локації, D73). Це звичайний перехід
 * статусу, права й правила перевіряє сервер.
 */
export default function ProductionCardActions({
  orderId,
  status,
  canReturn,
  action,
}: ProductionCardActionsProps) {
  if (status === "confirmed") {
    return (
      <OrderTransitionForm
        orderId={orderId}
        to="in_production"
        action={action}
        label={PRODUCTION_BUTTON_LABELS.start}
        needsNote={false}
        variant="fill"
        size="lg"
      />
    );
  }
  if (status === "in_production") {
    return (
      <OrderTransitionForm
        orderId={orderId}
        to="packed"
        action={action}
        label={PRODUCTION_BUTTON_LABELS.done}
        needsNote={false}
        variant="fill"
        size="lg"
      />
    );
  }
  if (status === "packed" && canReturn) {
    return (
      <OrderTransitionForm
        orderId={orderId}
        to="in_production"
        action={action}
        label={PRODUCTION_BUTTON_LABELS.back}
        needsNote
        noteLabel="Чому повертаєте в роботу"
        variant="outline"
        size="md"
      />
    );
  }
  return null;
}
