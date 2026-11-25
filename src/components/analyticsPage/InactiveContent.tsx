import Link from "next/link";
import type { InactiveClient } from "@/server/inactive";
import { formatIsoDate } from "@/utils/isoDate";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import { OneTimeForm, ThresholdForm } from "./InactiveForms";

const SOURCE = {
  client: "заданий у картці",
  rhythm: "за ритмом клієнта",
  default: "загальний",
} as const;

interface InactiveContentProps {
  clients: InactiveClient[];
  generalDays: number;
  /** Менеджер бачить лише своїх клієнтів. */
  ownOnly: boolean;
  canMark: boolean;
  /** Форма порога (лише власник); без неї не показуємо. */
  thresholdAction: FormAction | null;
  markAction: FormAction;
}

/**
 * «Давно не замовляли» (ТЗ 6.11, D207, D208): активні не разові клієнти, чиє останнє замовлення
 * старше за поріг. Кому час зателефонувати: найбільш прострочені зверху.
 */
export default function InactiveContent({
  clients,
  generalDays,
  ownOnly,
  canMark,
  thresholdAction,
  markAction,
}: InactiveContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <Text variant="muted">
        {ownOnly ? "Ваші клієнти" : "Активні клієнти"}, які замовляли раніше, але давно нічого не
        брали. Загальний поріг {generalDays} дн.; разових клієнтів тут немає.
      </Text>
      {thresholdAction ? <ThresholdForm days={generalDays} action={thresholdAction} /> : null}
      {clients.length === 0 ? (
        <EmptyState title="Таких клієнтів немає" description="Усі замовляють вчасно." />
      ) : (
        <ul className="flex flex-col gap-3">
          {clients.map((client) => (
            <Card as="li" key={client.clientId} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <SubTitle className="min-w-0 break-words">
                  <Link href={`/clients/${client.clientId}`}>{client.clientName}</Link>
                </SubTitle>
                <Tag className="shrink-0">{client.clientCode}</Tag>
              </div>
              <Text className="font-semibold">Не замовляє {client.days} дн.</Text>
              <Text variant="muted">
                Останнє замовлення {formatIsoDate(client.lastOrderDate)} · поріг{" "}
                {client.threshold.days} дн. ({SOURCE[client.threshold.source]})
                {client.managerName ? ` · ${client.managerName}` : ""}
              </Text>
              {canMark ? <OneTimeForm clientId={client.clientId} action={markAction} /> : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
