import {
  BACK_BUTTON_LABEL,
  CANCEL_BUTTON_LABEL,
  FORWARD_BUTTON_LABELS,
  NOTE_LABELS,
} from "@/constants/orders";
import type { TransitionOption } from "@/server/order-rules";
import type { FormAction } from "../clientsPage/clientActions";
import SectionTitle from "../shared/titles/SectionTitle";
import OrderTransitionForm from "./OrderTransitionForm";

interface OrderTransitionsProps {
  orderId: string;
  options: TransitionOption[];
  action: FormAction;
}

/**
 * Кнопки переходів, доступні ролі (D51). Крок вперед темною кнопкою, крок назад і скасування
 * контурними; ті, що потребують причини, ховаються в розкривний блок із полем причини.
 */
export default function OrderTransitions({ orderId, options, action }: OrderTransitionsProps) {
  if (options.length === 0) return null;

  return (
    <section aria-labelledby="order-actions" className="flex flex-col gap-3">
      <SectionTitle id="order-actions">Що далі</SectionTitle>
      {options.map((option) => {
        const isForward = option.kind === "forward";
        return (
          <OrderTransitionForm
            key={option.to}
            orderId={orderId}
            to={option.to}
            action={action}
            needsNote={option.needsNote}
            variant={isForward && !option.needsNote ? "fill" : "outline"}
            noteLabel={NOTE_LABELS[option.kind]}
            label={
              option.kind === "cancel"
                ? CANCEL_BUTTON_LABEL
                : option.kind === "back"
                  ? BACK_BUTTON_LABEL
                  : (FORWARD_BUTTON_LABELS[option.to] ?? "Далі")
            }
          />
        );
      })}
    </section>
  );
}
