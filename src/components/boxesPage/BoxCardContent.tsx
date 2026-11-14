import Link from "next/link";
import { BOX_EVENT_LABELS } from "@/server/audit-labels";
import type { BoxCard } from "@/server/boxes";
import { formatDateTime } from "@/utils/formatDate";
import { formatIsoDate } from "@/utils/isoDate";
import BackLink from "../shared/links/BackLink";
import ButtonLink from "../shared/buttons/ButtonLink";
import Tag from "../shared/chips/Tag";
import DetailList from "../shared/detailList/DetailList";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface BoxCardContentProps {
  box: BoxCard;
  /** Старший локації й власник можуть надрукувати наклейку цього бокса. */
  canPrint: boolean;
}

/** Картка бокса (ТЗ 6.7): код, тип, де він і в кого, історія подій від нових до старих. */
export default function BoxCardContent({ box, canPrint }: BoxCardContentProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <BackLink href="/boxes">Бокси</BackLink>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h1 text-navy">{box.code}</h2>
        <Tag>{box.statusLabel}</Tag>
      </div>
      <DetailList
        items={[
          { label: "Тип", value: box.boxTypeName },
          { label: "Домашня локація", value: box.locationName },
          {
            label: "Клієнт",
            value: box.clientId ? (
              <Link href={`/clients/${box.clientId}`}>{box.clientName}</Link>
            ) : null,
          },
          {
            label: "Замовлення",
            value:
              box.orderId && box.orderNumber ? (
                <Link href={`/orders/${box.orderId}`}>№ {box.orderNumber}</Link>
              ) : null,
          },
          {
            label: "Видано",
            value: box.issuedAt ? formatIsoDate(box.issuedAt.slice(0, 10)) : null,
          },
          {
            label: "Наклейку надруковано",
            value: box.labelPrintedAt ? formatIsoDate(box.labelPrintedAt.slice(0, 10)) : "Ще ні",
          },
        ]}
      />
      {canPrint ? (
        <ButtonLink
          href={`/api/boxes/labels?codes=${box.code}`}
          variant="outline"
          size="sm"
          isExternal
          className="self-start"
        >
          Наклейка в PDF
        </ButtonLink>
      ) : null}

      <section aria-labelledby="box-history" className="flex flex-col gap-3">
        <SectionTitle id="box-history">Історія</SectionTitle>
        <ul className="flex flex-col gap-3">
          {box.history.map((item) => (
            <li key={item.id} className="rounded-card border border-grey-field bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <Text variant="label">{capitalize(BOX_EVENT_LABELS[item.event])}</Text>
                <Text variant="muted">{formatDateTime(new Date(item.occurredAt))}</Text>
              </div>
              <Text variant="muted">
                {item.actorName}
                {item.clientName ? ` · ${item.clientName}` : ""}
                {item.orderNumber ? ` · № ${item.orderNumber}` : ""}
              </Text>
              {item.note ? <Text>{item.note}</Text> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
