import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { CashOrderView } from "@/server/cash";
import { CASH_RECEIVING_STATUSES } from "@/server/cash-rules";
import { formatMoney } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import StatusChip from "../shared/chips/StatusChip";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import CashEntryForm from "./CashEntryForm";
import type { CashActions } from "./cashTypes";
import ReverseEntryForm from "./ReverseEntryForm";

interface CashOrderCardProps {
  order: CashOrderView;
  /** Власник і старший локації записують готівку; менеджер і бухгалтер лише дивляться. */
  canRecord: boolean;
  /** Сторно лише власник (D69). */
  canReverse: boolean;
  /** Показувати локацію (коли екран охоплює кілька локацій). */
  showLocation: boolean;
  actions: CashActions;
}

const money = (value: string) => formatMoney(parseDecimal(value));

/** Хто перший: «Сплачено», «Частково» чи «Не сплачено» словом, не лише кольором. */
function paymentLabel(order: CashOrderView): string {
  if (order.isPaid) return "Сплачено";
  return order.isPartial ? "Частково" : "Не сплачено";
}

/**
 * Замовлення з готівковою оплатою на екрані «Готівка» (D67, D68): сума до сплати, прийнято, скільки
 * лишилось, записи з сторно і форма «Прийнято готівку». Старший локації бачить лише ці суми, а не
 * ціни за кг чи склад суми.
 */
export default function CashOrderCard({
  order,
  canRecord,
  canReverse,
  showLocation,
  actions,
}: CashOrderCardProps) {
  const canAccept =
    canRecord &&
    !order.isPaid &&
    parseDecimal(order.remainingSum) > 0 &&
    (CASH_RECEIVING_STATUSES as readonly string[]).includes(order.status);
  const settled = order.status === "paid" || order.status === "closed";
  const hasActiveEntries = order.entries.some((entry) => !entry.isReversed);

  return (
    <li
      id={`order-${order.id}`}
      className="flex scroll-mt-24 flex-col gap-4 rounded-card border border-grey-border bg-grey-light p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <SubTitle className="min-w-0 break-words">{order.clientName}</SubTitle>
        <Tag className="shrink-0">{order.clientCode}</Tag>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={order.status} />
        <Text as="span" className="font-semibold">
          {paymentLabel(order)}
        </Text>
        <Text as="span" variant="muted">
          № {order.number ?? "—"} · {DELIVERY_METHOD_LABELS[order.deliveryMethod]}
          {showLocation ? ` · ${order.locationName}` : ""}
        </Text>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt>
            <Text as="span" variant="muted">
              До сплати
            </Text>
          </dt>
          <dd className="text-lead font-bold text-navy">{money(order.amountDue)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt>
            <Text as="span" variant="muted">
              Прийнято
            </Text>
          </dt>
          <dd className="text-lead font-bold text-navy">{money(order.receivedSum)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt>
            <Text as="span" variant="muted">
              Лишилось
            </Text>
          </dt>
          <dd className="text-lead font-bold text-navy">{money(order.remainingSum)}</dd>
        </div>
      </dl>

      {order.entries.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Записи готівки">
          {order.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1 rounded-field border border-grey-border bg-white p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <Text as="span" className={entry.isReversed ? "line-through" : "font-semibold"}>
                  {money(entry.sumReceived)}
                </Text>
                <Text as="span" variant="muted">
                  {formatIsoDate(entry.receivedOn)} · {entry.receivedBy}
                  {entry.enteredVia === "driver_bot" ? " (через бот)" : ""}
                </Text>
              </div>
              {entry.note ? <Text variant="muted">{entry.note}</Text> : null}
              {entry.isReversed ? (
                <Text variant="error">Сторновано: {entry.reversalReason}</Text>
              ) : null}
              {canReverse && !entry.isReversed && !settled ? (
                <ReverseEntryForm entryId={entry.id} action={actions.reverse} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canReverse && settled && hasActiveEntries ? (
        <Text variant="muted">
          Щоб сторнувати запис, спершу поверніть замовлення зі статусу «Оплачено» на крок назад.
        </Text>
      ) : null}

      {canAccept ? (
        <CashEntryForm
          // Після запису форма оновлюється: сума за замовчуванням дорівнює новому залишку.
          key={`${order.id}-${order.remainingSum}`}
          orderId={order.id}
          remainingSum={order.remainingSum}
          action={actions.record}
        />
      ) : null}
    </li>
  );
}
