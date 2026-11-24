import type { QueueItem } from "@/server/payment-views";
import { formatIsoDate } from "@/utils/isoDate";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import { ManualMatchForm, ReasonForm, SuggestionForm } from "./MatchForms";
import PaymentCard from "./PaymentCard";
import type { PaymentActions } from "./paymentTypes";

interface QueueTabProps {
  items: QueueItem[];
  actions: PaymentActions;
}

const REASON_LABELS = {
  number: "номер у коментарі",
  name: "платник",
  amount: "сума",
} as const;

/**
 * Черга «Нерозпізнані» (ТЗ 6.10): платежі, які система не зіставила сама. Під кожним підказки
 * (замовлення з номера в коментарі, того ж клієнта, з такою самою сумою): вибір одним натисканням;
 * або ввід номера замовлення й суми, щоб розкласти платіж на кілька замовлень; або «Ігнорувати».
 */
export default function QueueTab({ items, actions }: QueueTabProps) {
  if (items.length === 0) {
    return <EmptyState title="Нерозпізнаних платежів немає" description="Усе зіставлено." />;
  }
  return (
    <ul className="flex flex-col gap-4">
      {items.map(({ payment, suggestions }) => (
        <PaymentCard key={payment.id} payment={payment}>
          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <Text variant="label">Може бути це замовлення:</Text>
              {suggestions.map((suggestion) => (
                <div key={suggestion.orderId} className="flex flex-col gap-2">
                  <Text>
                    № {suggestion.number ?? "—"} · {suggestion.clientName} ·{" "}
                    {formatIsoDate(suggestion.orderDate)} · залишок{" "}
                    {formatMoney(parseDecimal(suggestion.remaining))}{" "}
                    <Text as="span" variant="muted">
                      ({suggestion.reasons.map((reason) => REASON_LABELS[reason]).join(", ")})
                    </Text>
                  </Text>
                  <SuggestionForm
                    paymentId={payment.id}
                    orderId={suggestion.orderId}
                    amount={suggestion.apply}
                    label={`Зіставити з № ${suggestion.number ?? "—"} на ${formatMoney(parseDecimal(suggestion.apply))}`}
                    action={actions.match}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Text variant="muted">
              Підходящих замовлень не знайдено. Перевірте, що в замовленні вказано оплату ФОП чи
              компанії, або вкажіть номер замовлення нижче.
            </Text>
          )}
          <ManualMatchForm
            paymentId={payment.id}
            unallocated={payment.unallocated}
            action={actions.match}
          />
          {payment.matches.length === 0 ? (
            <ReasonForm
              paymentId={payment.id}
              action={actions.ignore}
              summary="Ігнорувати платіж"
              button="Ігнорувати"
              loadingText="Зберігаємо…"
              hint="Наприклад, переказ між своїми рахунками."
            />
          ) : null}
        </PaymentCard>
      ))}
    </ul>
  );
}
