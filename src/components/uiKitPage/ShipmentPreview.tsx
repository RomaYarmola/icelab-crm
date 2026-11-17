import OrderShipment, { type ShipmentActions } from "../ordersPage/OrderShipment";

interface ShipmentPreviewProps {
  formAction: ShipmentActions["create"];
}

const ready = { weightKg: 36, seats: 2, emptyWeightKnown: true };

/** Блок «Нова Пошта» у чотирьох станах для каталогу `/ui-kit`: чого бракує, форма, ТТН, помилка. */
export default function ShipmentPreview({ formAction }: ShipmentPreviewProps) {
  const actions = {
    create: formAction,
    price: formAction,
    remove: formAction,
    refresh: formAction,
  };
  const base = { canWrite: true, canSeeMoney: true };
  return (
    <div className="flex max-w-xl flex-col gap-10">
      <OrderShipment
        orderId="o1"
        actions={actions}
        card={{
          ...base,
          shipment: null,
          params: ready,
          blockers: [
            "Адреса потребує уточнення: підберіть місто й відділення в довіднику.",
            "Вкажіть телефон одержувача у форматі +380.",
          ],
        }}
      />
      <OrderShipment
        orderId="o2"
        actions={actions}
        card={{
          ...base,
          shipment: null,
          params: { ...ready, emptyWeightKnown: false },
          blockers: [],
        }}
      />
      <OrderShipment
        orderId="o3"
        actions={actions}
        card={{
          ...base,
          blockers: [],
          params: ready,
          shipment: {
            id: "s3",
            status: "created",
            statusLabel: "Створена",
            statusText: null,
            ttnNumber: "20450000000001",
            errorText: null,
            payer: "Recipient",
            weightKg: "36.000",
            seats: 2,
            createdInNpAt: "2026-11-17T09:30:00.000Z",
            costUah: "85.00",
          },
        }}
      />
      <OrderShipment
        orderId="o4"
        actions={actions}
        card={{
          ...base,
          blockers: [],
          params: ready,
          shipment: {
            id: "s4",
            status: "error",
            statusLabel: "Помилка",
            statusText: null,
            ttnNumber: null,
            errorText: "RecipientAddress is invalid",
            payer: "Recipient",
            weightKg: "36.000",
            seats: 2,
            createdInNpAt: null,
            costUah: null,
          },
        }}
      />
    </div>
  );
}
