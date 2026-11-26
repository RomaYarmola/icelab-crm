"use client";

import { useState } from "react";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { ClientDebt } from "@/server/payment-views";
import {
  amountField,
  buildDebtMessage,
  linkKey,
  PURPOSE_MAX,
  splitPaymentGroups,
} from "@/utils/debtMessage";
import { formatMoney } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { parseDecimal } from "@/utils/orderMath";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import Notification from "../shared/notification/Notification";
import type { PaymentActions } from "./paymentTypes";

interface DebtsTabProps {
  debts: ClientDebt[];
  requisites: string | null;
  debtDays: number;
  /** Створення посилань сервісом; `null`: ключа немає чи роль не має права, лишається вручну. */
  createLinks: PaymentActions["createLinks"] | null;
}

/**
 * Вкладка «Борги» (ТЗ 6.10, D196, D197): клієнти з відправленими, але не оплаченими замовленнями
 * (поріг у днях від відправки чи видачі). Для кожного клієнта можна відзначити замовлення й отримати
 * готове повідомлення з сумою й номерами для призначення платежу: його копіюють у месенджер.
 */
export default function DebtsTab({ debts, requisites, debtDays, createLinks }: DebtsTabProps) {
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
        <DebtCard
          key={debt.clientId}
          debt={debt}
          requisites={requisites}
          createLinks={createLinks}
        />
      ))}
    </ul>
  );
}

function DebtCard({
  debt,
  requisites,
  createLinks,
}: {
  debt: ClientDebt;
  requisites: string | null;
  createLinks: DebtsTabProps["createLinks"];
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(debt.orders.map((order) => order.id)),
  );
  const [copied, setCopied] = useState<string | null>(null);
  // Посилання за сумою й призначенням: після зміни вибору старе не потрапить у повідомлення.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [isCreating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const selected = debt.orders.filter((order) => checked.has(order.id));
  const groups = splitPaymentGroups(selected);
  const groupLinks = groups.map((group) => links[linkKey(group)]);
  const message = buildDebtMessage(selected, requisites, groupLinks);
  const isMissingLink = groupLinks.some((link) => !link);

  const create = async () => {
    if (!createLinks) return;
    setCreating(true);
    setLinkError(null);
    setCopied(null);
    try {
      const result = await createLinks({
        clientId: debt.clientId,
        orderIds: selected.map((order) => order.id),
      });
      setLinks((previous) => ({ ...previous, ...result.links }));
      setLinkError(result.error);
    } catch {
      setLinkError("Немає зв'язку. Перевірте інтернет і повторіть.");
    } finally {
      setCreating(false);
    }
  };

  const toggle = (id: string) => {
    setCopied(null);
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
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
      {createLinks && groups.length > 0 ? (
        <div className="flex flex-col gap-2">
          {isMissingLink ? (
            <MainButton
              type="button"
              onClick={create}
              isLoading={isCreating}
              loadingText="Створюємо…"
            >
              {groups.length > 1 ? "Створити посилання на оплату" : "Створити посилання"}
            </MainButton>
          ) : (
            <Notification variant="success">Посилання додано в повідомлення.</Notification>
          )}
          {linkError ? <Notification variant="error">{linkError}</Notification> : null}
        </div>
      ) : null}
      {groups.length > 0 ? (
        <Disclosure
          variant="plain"
          summary={createLinks ? "Посилання вручну" : "Посилання на оплату (ibanoplata.com)"}
        >
          <div className="flex flex-col gap-4">
            <Text variant="muted">
              Створіть у кабінеті сервісу посилання з цією сумою й призначенням, вставте його нижче:
              воно потрапить у повідомлення.
              {groups.length > 1
                ? ` Призначення в сервісі не довше ${PURPOSE_MAX} символів, тому потрібно ${groups.length} посилання.`
                : ""}
            </Text>
            {groups.map((group, index) => (
              <div key={group.numbers.join("-")} className="flex flex-col gap-2">
                {groups.length > 1 ? <Text variant="label">Посилання {index + 1}</Text> : null}
                <Text>
                  Сума: <b>{amountField(group.kopecks)}</b>
                </Text>
                <MainButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(`sum${index}`, amountField(group.kopecks))}
                >
                  {copied === `sum${index}` ? "Скопійовано" : "Скопіювати суму"}
                </MainButton>
                <Text className="break-words">
                  Призначення ({group.purpose.length} з {PURPOSE_MAX}): <b>{group.purpose}</b>
                </Text>
                <MainButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(`purpose${index}`, group.purpose)}
                >
                  {copied === `purpose${index}` ? "Скопійовано" : "Скопіювати призначення"}
                </MainButton>
                <CustomizedInput
                  name={`link${index}`}
                  label="Посилання з сервісу"
                  autoComplete="off"
                  inputMode="url"
                  value={links[linkKey(group)] ?? ""}
                  onChange={(event) =>
                    setLinks((previous) => ({
                      ...previous,
                      [linkKey(group)]: event.target.value,
                    }))
                  }
                  hint="https://ibanoplata.com/iban-qr/…"
                />
              </div>
            ))}
          </div>
        </Disclosure>
      ) : null}
      {message ? (
        <>
          <textarea
            readOnly
            value={message}
            rows={Math.min(14, message.split("\n").length + 1)}
            aria-label="Повідомлення клієнтові"
            className="w-full rounded-card border border-grey-field bg-white p-3 text-body text-navy"
          />
          <MainButton type="button" variant="outline" onClick={() => copy("message", message)}>
            {copied === "message" ? "Скопійовано" : "Скопіювати повідомлення"}
          </MainButton>
        </>
      ) : (
        <Text variant="muted">Відзначте хоча б одне замовлення.</Text>
      )}
    </Card>
  );
}
