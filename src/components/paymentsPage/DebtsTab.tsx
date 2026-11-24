"use client";

import { useState } from "react";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { ClientDebt } from "@/server/payment-views";
import { buildDebtMessage } from "@/utils/debtMessage";
import { formatMoney } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import EmptyState from "../shared/emptyState/EmptyState";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface DebtsTabProps {
  debts: ClientDebt[];
  requisites: string | null;
  debtDays: number;
}

/**
 * Вкладка «Борги» (ТЗ 6.10, D196, D197): клієнти з відправленими, але не оплаченими замовленнями
 * (поріг у днях від відправки чи видачі). Для кожного клієнта можна відзначити замовлення й отримати
 * готове повідомлення з сумою й номерами для призначення платежу: його копіюють у месенджер.
 */
export default function DebtsTab({ debts, requisites, debtDays }: DebtsTabProps) {
  if (debts.length === 0) {
    return (
      <EmptyState
        title="Боргів немає"
        description={`Тут клієнти, у яких відправлене замовлення не оплачене ${debtDays} дн. і більше.`}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {debts.map((debt) => (
        <DebtCard key={debt.clientId} debt={debt} requisites={requisites} />
      ))}
    </ul>
  );
}

function DebtCard({ debt, requisites }: { debt: ClientDebt; requisites: string | null }) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(debt.orders.map((order) => order.id)),
  );
  const [copied, setCopied] = useState(false);
  const selected = debt.orders.filter((order) => checked.has(order.id));
  const message = buildDebtMessage(selected, requisites);

  const toggle = (id: string) => {
    setCopied(false);
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card as="li" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <SubTitle className="min-w-0 break-words">{debt.clientName}</SubTitle>
        <Tag className="shrink-0">{debt.clientCode}</Tag>
      </div>
      <Text className="font-semibold">Борг: {formatMoney(parseDecimal(debt.total))}</Text>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Замовлення для повідомлення</legend>
        {debt.orders.map((order) => (
          <label key={order.id} className="flex min-h-11 items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={checked.has(order.id)}
              onChange={() => toggle(order.id)}
              className="size-5 shrink-0 accent-navy"
            />
            <span className="min-w-0 break-words">
              № {order.number ?? "—"} · {formatIsoDate(order.orderDate)} ·{" "}
              {formatMoney(parseDecimal(order.remaining))} ·{" "}
              {DELIVERY_METHOD_LABELS[order.deliveryMethod]}, {order.days} дн.
            </span>
          </label>
        ))}
      </fieldset>
      {message ? (
        <>
          <textarea
            readOnly
            value={message}
            rows={Math.min(14, message.split("\n").length + 1)}
            aria-label="Повідомлення клієнтові"
            className="w-full rounded-card border border-grey-field bg-white p-3 text-body text-navy"
          />
          <MainButton type="button" variant="outline" onClick={copy}>
            {copied ? "Скопійовано" : "Скопіювати повідомлення"}
          </MainButton>
        </>
      ) : (
        <Text variant="muted">Відзначте хоча б одне замовлення.</Text>
      )}
    </Card>
  );
}
