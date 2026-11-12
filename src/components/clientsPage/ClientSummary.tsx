import { LEGAL_TYPE_LABELS } from "@/constants/clients";
import type { ClientCardView } from "@/server/client-views";
import DetailList from "../shared/detailList/DetailList";

/** Перегляд полів картки клієнта (для ролей, які клієнтів лише читають, і для видалених). */
export default function ClientSummary({ client }: { client: ClientCardView }) {
  return (
    <DetailList
      items={[
        {
          label: "Тип клієнта",
          value: client.legalType ? LEGAL_TYPE_LABELS[client.legalType] : null,
        },
        { label: "Статус", value: client.statusName },
        { label: "Менеджер", value: client.managerName },
        { label: "Застосування", value: client.applicationName },
        { label: "Джерело", value: client.sourceName },
        { label: "Основний тип льоду", value: client.iceTypeName },
        { label: "Основна тара", value: client.boxTypeName },
        { label: "ЄДРПОУ або ІПН", value: client.edrpou },
        {
          label: "Окрема надбавка, %",
          value:
            client.markupPercentOverride === null ? null : Number(client.markupPercentOverride),
        },
        {
          label: "Нагадати, якщо не замовляє, днів",
          value: client.inactiveDaysThreshold,
        },
        { label: "Примітка", value: client.notes },
      ]}
    />
  );
}
