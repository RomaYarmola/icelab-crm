import ShipmentDayContent from "../shipmentsPage/ShipmentDayContent";
import type { ShipmentDayActions } from "../shipmentsPage/shipmentTypes";
import type { ShipmentDayRow } from "@/server/np/shipment-day";

const row = (i: number, overrides: Partial<ShipmentDayRow> = {}): ShipmentDayRow => ({
  orderId: `o${i}`,
  number: 3400 + i,
  clientId: `c${i}`,
  clientName: ["Кафе «Вогник»", "ФОП Іваненко", "Бар «Лід»", "ТОВ «Айс»", "Івент-агенція «Дим»"][
    i % 5
  ]!,
  locationName: "Київ",
  status: "confirmed",
  recipient: "Коваль Олена, +380501234567",
  addressText: "Київ, відділення № 5",
  weightKg: 36,
  seats: 2,
  blockers: [],
  needsAddress: false,
  shipment: null,
  selectable: true,
  ...overrides,
});

const ROWS: ShipmentDayRow[] = [
  row(0),
  row(1),
  row(2),
  row(3, {
    selectable: false,
    needsAddress: true,
    addressText: "Березівка, відділення № 3",
    blockers: ["Адреса потребує уточнення: підберіть місто й відділення в довіднику."],
  }),
  row(4, {
    selectable: false,
    status: "packed",
    shipment: {
      id: "s4",
      status: "created",
      statusLabel: "Створена",
      ttnNumber: "20450000000001",
      errorText: null,
    },
  }),
];

/** «ТТН на день» з вигаданими даними для каталогу `/ui-kit`. */
export default function ShipmentDayPreview({ createStep }: ShipmentDayActions) {
  return (
    <ShipmentDayContent
      day={{ date: "2026-11-17", rows: ROWS }}
      today="2026-11-17"
      actions={{ createStep }}
    />
  );
}
