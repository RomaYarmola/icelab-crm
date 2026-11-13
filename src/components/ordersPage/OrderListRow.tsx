import Link from "next/link";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { OrderListItem } from "@/server/order-views";
import { formatKg, formatMoney, formatNumber } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import StatusChip from "../shared/chips/StatusChip";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface OrderListRowProps {
  order: OrderListItem;
  /** Показувати дату виконання (коли список охоплює кілька днів). */
  showDate: boolean;
}

/**
 * Рядок списку замовлень: клієнт, номер і код, статус, скільки й чого, спосіб доставки. Сума лише
 * у тих, хто бачить гроші (старший локації її не отримує). «Виготовити» показуємо, якщо воно
 * відрізняється від проданого. Веде на картку замовлення.
 */
export default function OrderListRow({ order, showDate }: OrderListRowProps) {
  const sold = parseDecimal(order.kgSold);
  const toProduce = parseDecimal(order.kgToProduce);
  const amounts =
    toProduce !== sold && toProduce > 0
      ? `${formatKg(sold)}, виготовити ${formatNumber(toProduce)} кг`
      : formatKg(sold);
  const details = [
    order.iceTypeName,
    DELIVERY_METHOD_LABELS[order.deliveryMethod],
    order.locationName,
    showDate ? formatIsoDate(order.orderDate) : null,
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className="flex flex-col gap-1.5 rounded-card border border-grey-border bg-grey-light p-4 transition active:scale-[98%] lg:hover:border-grey-field"
      >
        <div className="flex items-start justify-between gap-3">
          <SubTitle className="min-w-0 break-words">{order.clientName}</SubTitle>
          <Tag className="shrink-0">{order.clientCode}</Tag>
        </div>
        <Text variant="muted">№ {order.number ?? "—"}</Text>
        <div className="flex items-center justify-between gap-2">
          <Text>{amounts}</Text>
          {order.total !== undefined ? (
            <Text variant="lead" className="font-bold whitespace-nowrap">
              {formatMoney(parseDecimal(order.total))}
            </Text>
          ) : null}
        </div>
        <Text variant="muted">{details.join(" · ")}</Text>
        <StatusChip status={order.status} className="mt-0.5 w-fit" />
      </Link>
    </li>
  );
}
