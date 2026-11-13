import { ORDER_STATUS_LABELS } from "@/constants/orders";
import type { OrderHistoryItem } from "@/server/order-views";
import { formatDateTime } from "@/utils/formatDate";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

/** Історія статусів: хто, коли й чому змінив. Перший запис це створення замовлення. */
export default function OrderHistory({ history }: { history: OrderHistoryItem[] }) {
  return (
    <section aria-labelledby="order-history" className="flex flex-col gap-3">
      <SectionTitle id="order-history">Історія</SectionTitle>
      <ol className="flex flex-col gap-3">
        {history.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5 border-l-2 border-grey-border pl-3">
            <Text variant="label">
              {entry.fromStatus
                ? `${ORDER_STATUS_LABELS[entry.fromStatus]} → ${ORDER_STATUS_LABELS[entry.toStatus]}`
                : `Створено: ${ORDER_STATUS_LABELS[entry.toStatus].toLowerCase()}`}
            </Text>
            <Text variant="muted">
              {formatDateTime(entry.changedAt)}
              {entry.changedByName ? ` · ${entry.changedByName}` : " · система"}
            </Text>
            {entry.note ? (
              <Text className="break-words whitespace-pre-line">{entry.note}</Text>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
