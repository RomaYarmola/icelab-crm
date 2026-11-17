import type { ShipmentCard } from "@/server/np/shipments";
import { NP_PAYER_LABELS } from "@/constants/np";
import { formatDateTime } from "@/utils/formatDate";
import type { FormAction } from "../clientsPage/clientActions";
import DeleteRecordForm from "../clientsPage/DeleteRecordForm";
import ButtonLink from "../shared/buttons/ButtonLink";
import Tag from "../shared/chips/Tag";
import DetailList from "../shared/detailList/DetailList";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import ShipmentCreateForm from "./ShipmentCreateForm";

export interface ShipmentActions {
  create: FormAction;
  price: FormAction;
  remove: FormAction;
}

interface OrderShipmentProps {
  orderId: string;
  card: ShipmentCard;
  actions: ShipmentActions;
}

/**
 * Блок «Нова Пошта» на картці замовлення (ТЗ 6.8): номер ТТН, статус, вартість, «Стікер PDF» і
 * «Видалити ТТН»; поки накладної немає, форма створення або список того, чого бракує. Вартість
 * лише ролям, що бачать гроші замовлення.
 */
export default function OrderShipment({ orderId, card, actions }: OrderShipmentProps) {
  const { shipment } = card;
  const hasTtn = Boolean(shipment?.ttnNumber);

  return (
    <section aria-labelledby="order-np" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle id="order-np">Нова Пошта</SectionTitle>
        {shipment ? <Tag className="shrink-0">{shipment.statusLabel}</Tag> : null}
      </div>

      {hasTtn && shipment ? (
        <>
          <DetailList
            items={[
              { label: "Номер ТТН", value: shipment.ttnNumber },
              { label: "Статус Нової Пошти", value: shipment.statusText },
              {
                label: "Платник",
                value: NP_PAYER_LABELS[shipment.payer],
              },
              {
                label: "Вага, місць",
                value: shipment.weightKg
                  ? `${Number(shipment.weightKg).toLocaleString("uk-UA")} кг, ${shipment.seats}`
                  : null,
              },
              ...(card.canSeeMoney
                ? [
                    {
                      label: "Вартість доставки",
                      value:
                        shipment.costUah != null
                          ? `${Number(shipment.costUah).toLocaleString("uk-UA")} ₴`
                          : null,
                    },
                  ]
                : []),
              {
                label: "Створено",
                value: shipment.createdInNpAt
                  ? formatDateTime(new Date(shipment.createdInNpAt))
                  : null,
              },
            ]}
          />
          <ButtonLink
            href={`/api/shipments/${shipment.id}/sticker`}
            variant="outline"
            isExternal
            className="w-full lg:w-auto lg:self-start"
          >
            Стікер PDF
          </ButtonLink>
          {card.canWrite ? (
            <DeleteRecordForm
              action={actions.remove}
              id={orderId}
              summary="Видалити ТТН"
              warning="Накладна видалиться в Новій Пошті й тут. Це можливо лише до передачі посилки у відділення; після видалення можна створити нову."
            />
          ) : null}
        </>
      ) : card.blockers.length > 0 ? (
        <>
          {shipment?.errorText ? (
            <Notification variant="error">{shipment.errorText}</Notification>
          ) : null}
          <Notification variant="info" title="Щоб створити ТТН">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {card.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Notification>
        </>
      ) : (
        <>
          {shipment?.errorText ? (
            <Notification variant="error" title="Минулого разу не вдалося">
              {shipment.errorText}
            </Notification>
          ) : null}
          <Text variant="muted">
            Вага посилки {card.params.weightKg.toLocaleString("uk-UA")} кг, місць{" "}
            {card.params.seats}.
            {card.params.emptyWeightKnown
              ? ""
              : " Вагу порожніх боксів не вказано (екран «Нова Пошта»), тож рахується лише лід."}
          </Text>
          {card.canWrite ? (
            <ShipmentCreateForm
              orderId={orderId}
              createAction={actions.create}
              priceAction={card.canSeeMoney ? actions.price : null}
              submitLabel={shipment?.errorText ? "Спробувати ще раз" : "Створити ТТН"}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
