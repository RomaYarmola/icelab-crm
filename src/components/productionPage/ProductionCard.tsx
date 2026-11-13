"use client";

import { cn } from "@/utils/cn";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { ProductionCard as ProductionCardData } from "@/server/production";
import { parseDecimal } from "@/utils/orderMath";
import { describeBoxes, formatKgPlain } from "@/utils/productionView";
import StatusChip from "../shared/chips/StatusChip";
import Tag from "../shared/chips/Tag";
import DetailList from "../shared/detailList/DetailList";
import Text from "../shared/texts/Text";
import ProductionCardActions from "./ProductionCardActions";
import ProductionEditForm from "./ProductionEditForm";
import type { ProductionActions } from "./productionTypes";

interface ProductionCardProps {
  card: ProductionCardData;
  /** Підсвічене «Нове»: цех ще не бачив замовлення, або воно з'явилось під час роботи екрана. */
  highlighted: boolean;
  /** Режим «планшет на стіні»: крупніше, лише перегляд (D66). */
  wall: boolean;
  /** Цех і старший локації: кнопки «Розпочати» і «Готово». Власник і менеджер лише дивляться. */
  canWork: boolean;
  /** Старший локації: змінити кг і коментар, повернути в роботу. */
  canEdit: boolean;
  /** Показувати локацію (коли черга охоплює кілька локацій). */
  showLocation: boolean;
  actions: ProductionActions;
}

/**
 * Картка замовлення на екрані цеху (D63, ТЗ 6.4): клієнт і «виготовити» крупно, тип льоду, тара,
 * куди й коли, коментар. Цін і сум немає. Нове замовлення має кольорову смужку й слово «Нове»,
 * запаковане стоїть внизу сірим; статус завжди підписано словом, не лише кольором.
 */
export default function ProductionCard({
  card,
  highlighted,
  wall,
  canWork,
  canEdit,
  showLocation,
  actions,
}: ProductionCardProps) {
  const packed = card.status === "packed";
  const toProduce = parseDecimal(card.kgToProduce);
  const sold = parseDecimal(card.kgSold);
  const boxes = describeBoxes(card);
  const place = `${DELIVERY_METHOD_LABELS[card.deliveryMethod]}: ${card.deliveryPlace}`;

  const details = [
    { label: "Лід", value: card.iceTypeName },
    ...(boxes ? [{ label: "Тара", value: boxes }] : []),
    {
      label: "Куди",
      value: card.deliveryMethod === "pickup" ? card.deliveryPlace : place,
    },
    ...(card.timeWindow ? [{ label: "Коли", value: card.timeWindow }] : []),
    ...(card.comment ? [{ label: "Коментар", value: card.comment }] : []),
  ];

  return (
    <li
      className={cn(
        "flex flex-col rounded-card border",
        wall ? "gap-5 p-6" : "gap-4 p-4",
        packed ? "border-grey-border bg-grey-light" : "border-grey-field bg-white",
        highlighted && "border-l-8 border-l-blue",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className={cn("min-w-0 break-words text-navy", wall ? "text-wall-title" : "text-h2")}>
          {card.clientName}
        </h3>
        <Tag className="shrink-0">{card.clientCode}</Tag>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={card.status} />
        {highlighted ? (
          <span className="inline-flex min-h-8 items-center rounded-full bg-blue px-3 text-body font-semibold text-white">
            Нове
          </span>
        ) : null}
        <Text as="span" variant="muted">
          № {card.number ?? "—"}
        </Text>
        {showLocation ? (
          <Text as="span" variant="muted">
            {card.locationName}
          </Text>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <Text variant="muted">Виготовити</Text>
        <p className={cn("text-navy", wall ? "text-wall" : "text-hero")}>
          {formatKgPlain(toProduce)} кг
        </p>
        {sold !== toProduce ? <Text variant="muted">Продано {formatKgPlain(sold)} кг</Text> : null}
      </div>

      <DetailList items={details} />

      {!wall && canWork ? (
        <div className="flex flex-col gap-3">
          <ProductionCardActions
            orderId={card.id}
            status={card.status}
            canReturn={canEdit}
            action={actions.transition}
          />
          {canEdit ? (
            <ProductionEditForm
              orderId={card.id}
              kgToProduce={formatKgPlain(toProduce)}
              comment={card.comment}
              action={actions.updateOrder}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
