import {
  BOX_OWNERSHIP_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_KIND_LABELS,
} from "@/constants/orders";
import type { OrderCardView } from "@/server/order-views";
import { formatDateTime } from "@/utils/formatDate";
import { formatKg } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import { formatPhone } from "@/utils/phone";
import DetailList, { type DetailItem } from "../shared/detailList/DetailList";

/** Основні дані замовлення переліком «назва: значення». Поля, яких роль не отримує, не показуємо. */
export default function OrderSummary({ order }: { order: OrderCardView }) {
  const sold = parseDecimal(order.kgSold);
  const toProduce = parseDecimal(order.kgToProduce);
  const percent = order.markupPercentApplied ? parseDecimal(order.markupPercentApplied) : 0;

  const items: DetailItem[] = [
    { label: "Дата виконання", value: formatIsoDate(order.orderDate) },
    { label: "Локація", value: order.locationName },
    { label: "Джерело", value: order.sourceName },
    {
      label: "Лід",
      value:
        [order.iceTypeName, sold > 0 ? formatKg(sold) : null].filter(Boolean).join(", ") || null,
    },
    {
      label: "Виготовити",
      value:
        toProduce > 0
          ? `${formatKg(toProduce)}${toProduce !== sold && percent > 0 ? ` (надбавка ${percent}%)` : ""}`
          : null,
    },
    { label: "Спосіб доставки", value: DELIVERY_METHOD_LABELS[order.deliveryMethod] },
    { label: "Адреса", value: order.addressText ?? order.deliveryText },
    { label: "Вікно часу", value: order.timeWindow },
    {
      label: "Отримувач",
      value:
        order.recipientName || order.recipientPhone ? (
          <>
            {order.recipientName}
            {order.recipientName && order.recipientPhone ? ", " : ""}
            {order.recipientPhone ? (
              <a
                href={`tel:${order.recipientPhone}`}
                className="inline-flex min-h-11 items-center font-semibold text-blue"
              >
                {formatPhone(order.recipientPhone)}
              </a>
            ) : null}
          </>
        ) : null,
    },
    {
      label: "Тара",
      value:
        order.boxTypeName || order.boxCount > 0
          ? [
              order.boxTypeName,
              order.boxCount > 0 ? `${order.boxCount} шт` : null,
              BOX_OWNERSHIP_LABELS[order.boxOwnership],
            ]
              .filter(Boolean)
              .join(", ")
          : null,
    },
  ];
  // Спосіб оплати лише тим, хто бачить гроші чи готівку.
  if (order.paymentKind !== undefined) {
    items.push({
      label: "Оплата",
      value: order.paidAt
        ? `${PAYMENT_KIND_LABELS[order.paymentKind]}, оплачено ${formatDateTime(order.paidAt)}`
        : PAYMENT_KIND_LABELS[order.paymentKind],
    });
  }
  items.push({ label: "Коментар для виробництва", value: order.comment });
  if (order.internalComment !== undefined) {
    items.push({ label: "Внутрішній коментар", value: order.internalComment });
  }

  return <DetailList items={items} />;
}
