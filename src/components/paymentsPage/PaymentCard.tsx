import type { ReactNode } from "react";
import { PAYMENT_MATCH_STATUS_LABELS, PAYMENT_RULE_LABELS } from "@/server/audit-labels";
import type { PaymentView } from "@/server/payment-views";
import { formatDateTime } from "@/utils/formatDate";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface PaymentCardProps {
  payment: PaymentView;
  /** Форми дій під описом (зіставити, ігнорувати…). */
  children?: ReactNode;
}

/**
 * Платіж на екрані «Оплати»: сума, дата, платник, коментар, статус зіставлення словом і замовлення,
 * на які його розкладено. Використовують і «Виписка», і «Нерозпізнані».
 */
export default function PaymentCard({ payment, children }: PaymentCardProps) {
  const unallocated = parseDecimal(payment.unallocated);
  const partial = payment.matches.length > 0 && unallocated > 0;
  return (
    <li
      id={`payment-${payment.id}`}
      className="flex scroll-mt-24 flex-col gap-3 rounded-card border border-grey-border bg-grey-light p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SubTitle>{formatMoney(parseDecimal(payment.amount))}</SubTitle>
          <Text variant="muted">{formatDateTime(payment.occurredAt)}</Text>
        </div>
        <Tag className="shrink-0">{PAYMENT_MATCH_STATUS_LABELS[payment.matchStatus]}</Tag>
      </div>

      <div className="flex flex-col gap-0.5">
        <Text className="break-words font-semibold">
          {payment.counterName ?? "Платник невідомий"}
        </Text>
        {payment.comment ? <Text className="break-words">{payment.comment}</Text> : null}
        {payment.description && payment.description !== payment.comment ? (
          <Text variant="muted" className="break-words">
            {payment.description}
          </Text>
        ) : null}
        {payment.importedVia === "file" ? <Text variant="muted">З файла виписки</Text> : null}
      </div>

      {payment.matchStatus === "ignored" && payment.ignoredReason ? (
        <Text variant="muted">Ігноровано: {payment.ignoredReason}</Text>
      ) : null}

      {payment.matches.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {payment.matches.map((match) => (
            <li key={match.orderId}>
              <Text>
                Замовлення № {match.orderNumber ?? "—"} · {match.clientName} ·{" "}
                {formatMoney(parseDecimal(match.amount))}{" "}
                <Text as="span" variant="muted">
                  ({PAYMENT_RULE_LABELS[match.rule]})
                </Text>
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
      {partial ? (
        <Text className="font-semibold">Ще не розкладено: {formatMoney(unallocated)}</Text>
      ) : null}

      {children}
    </li>
  );
}
