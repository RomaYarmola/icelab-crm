import type { OrderItemView } from "@/server/dto";
import type { PriceChangeView } from "@/server/order-views";
import { formatDateTime } from "@/utils/formatDate";
import { formatMoney, formatNumber, formatPricePerKg } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import Card from "../shared/cards/Card";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";

interface OrderItemsListProps {
  items: OrderItemView[];
  /** Сума замовлення (`undefined`, якщо роль не бачить грошей). */
  total?: string;
  /** Ціна за кг, зафіксована при підтвердженні (D52). */
  lockedPrice?: string | null;
  priceChanges?: PriceChangeView[];
}

/**
 * Позиції замовлення з цінами й сумою. Ролі без права на гроші бачать лише назви й кількість
 * (поля `price` і `amount` до них не доходять). Зафіксована при підтвердженні ціна й зміни ціни
 * власником видно тим, хто бачить гроші.
 */
export default function OrderItemsList({
  items,
  total,
  lockedPrice,
  priceChanges,
}: OrderItemsListProps) {
  return (
    <section aria-labelledby="order-items" className="flex flex-col gap-3">
      <SectionTitle id="order-items">Позиції</SectionTitle>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <Card as="li" key={item.id} className="flex flex-col gap-1">
            <SubTitle className="break-words">{item.title}</SubTitle>
            <div className="flex items-center justify-between gap-3">
              <Text>
                {formatNumber(parseDecimal(item.qty))} {item.unit}
                {item.price !== undefined ? ` × ${formatMoney(parseDecimal(item.price))}` : ""}
              </Text>
              {item.amount !== undefined ? (
                <Text variant="lead" className="font-bold whitespace-nowrap">
                  {formatMoney(parseDecimal(item.amount))}
                </Text>
              ) : null}
            </div>
          </Card>
        ))}
      </ul>
      {total !== undefined ? (
        <div className="flex items-baseline justify-between gap-3 border-t border-grey-border pt-3">
          <Text variant="label">Разом</Text>
          <Text variant="kpi" className="font-extrabold">
            {formatMoney(parseDecimal(total))}
          </Text>
        </div>
      ) : null}
      {lockedPrice ? (
        <Text variant="muted">
          Ціну зафіксовано при підтвердженні: {formatPricePerKg(lockedPrice)}.
        </Text>
      ) : null}
      {priceChanges && priceChanges.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {priceChanges.map((change) => (
            <li
              key={change.id}
              className="flex flex-col gap-0.5 border-l-2 border-grey-border pl-3"
            >
              <Text variant="label">
                Ціну змінено: {formatPricePerKg(change.oldPrice)} →{" "}
                {formatPricePerKg(change.newPrice)}
              </Text>
              <Text variant="muted">
                {formatDateTime(change.changedAt)}
                {change.changedByName ? ` · ${change.changedByName}` : ""}
              </Text>
              <Text className="break-words whitespace-pre-line">{change.note}</Text>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
