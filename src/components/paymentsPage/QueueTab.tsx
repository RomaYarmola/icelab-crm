import type { QueueItem } from "@/server/payment-views";
import { formatIsoDate } from "@/utils/isoDate";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import {
  ByNumbersForm,
  ManualMatchForm,
  ReasonForm,
  SelectOrdersForm,
  SuggestionForm,
} from "./MatchForms";
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
      {items.map(({ payment, suggestions, named, clientOrders }) => (
        <PaymentCard key={payment.id} payment={payment}>
          {named.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Text variant="label">У призначенні названо замовлення:</Text>
              <ul className="flex flex-col gap-1">
                {named.map((item) => (
                  <li key={item.number}>
                    <Text>
                      № {item.number}
                      {item.clientName ? ` · ${item.clientName}` : ""}
                      {item.problem
                        ? `: ${item.problem}`
                        : ` · залишок ${formatMoney(parseDecimal(item.remaining ?? "0"))}`}
                    </Text>
                  </li>
                ))}
              </ul>
              {named.every((item) => item.problem === null) ? (
                <>
                  <Text variant="muted">
                    Сума платежу не збіглася із сумою названих замовлень. Кнопка гасить їх по
                    порядку номерів, а те, що не вистачило чи лишилось, лишається на платежі.
                  </Text>
                  <ByNumbersForm
                    paymentId={payment.id}
                    action={actions.byNumbers}
                    label="Погасити за номерами з призначення"
                  />
                </>
              ) : (
                <Text variant="muted">
                  Автоматично закрити не можна, поки з номерами щось не так. Виправте замовлення чи
                  оберіть інші нижче.
                </Text>
              )}
            </div>
          ) : null}
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
          {clientOrders.length > 0 ? (
            <SelectOrdersForm
              paymentId={payment.id}
              action={actions.selected}
              options={clientOrders.map((order) => ({
                orderId: order.orderId,
                label: `№ ${order.number ?? "—"} · ${order.clientName} · ${formatIsoDate(order.orderDate)} · залишок ${formatMoney(parseDecimal(order.remaining))}`,
              }))}
            />
          ) : null}
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
