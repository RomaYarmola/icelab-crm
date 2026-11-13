import type { CashDay, CashOrderView } from "@/server/cash";
import type { UserRole } from "@/server/permissions";
import CashPageContent from "../cashPage/CashPageContent";
import type { CashActions } from "../cashPage/cashTypes";

/**
 * Екран «Готівка» з вигаданими даними для перегляду `/ui-kit/shell/<роль>?screen=cash`. Той самий
 * компонент, що й на сервері: записують власник і старший локації, сторнує лише власник, менеджер і
 * бухгалтер дивляться. Суми загальні, цін за кг тут немає ні в кого.
 */

export const CASH_PREVIEW_SCREENS = ["cash", "cash-empty"] as const;
export type CashPreviewScreen = (typeof CASH_PREVIEW_SCREENS)[number];

const TODAY = "2026-11-13";

const base = {
  locationId: "preview-kyiv",
  locationName: "Київ",
  orderDate: TODAY,
};

const ORDERS: CashOrderView[] = [
  {
    ...base,
    id: "o1",
    number: 3472,
    clientCode: "АА15",
    clientName: "Кафе «Вогник»",
    status: "shipped",
    deliveryMethod: "our_delivery",
    amountDue: "2250.00",
    receivedSum: "1000.00",
    remainingSum: "1250.00",
    isPaid: false,
    isPartial: true,
    entries: [
      {
        id: "e1",
        sumReceived: "1000.00",
        receivedOn: TODAY,
        receivedBy: "Водій Іван",
        enteredVia: "driver_bot",
        note: "Решту клієнт доплатить завтра",
        isReversed: false,
        reversalReason: null,
      },
    ],
  },
  {
    ...base,
    id: "o2",
    number: 3471,
    clientCode: "ВС57",
    clientName: "ФОП Іваненко Петро Олексійович",
    status: "closed",
    deliveryMethod: "pickup",
    amountDue: "900.00",
    receivedSum: "900.00",
    remainingSum: "0.00",
    isPaid: true,
    isPartial: false,
    entries: [
      {
        id: "e2",
        sumReceived: "450.00",
        receivedOn: TODAY,
        receivedBy: "Тест: Старший локації",
        enteredVia: "web",
        note: null,
        isReversed: true,
        reversalReason: "Записано не в те замовлення",
      },
      {
        id: "e3",
        sumReceived: "900.00",
        receivedOn: TODAY,
        receivedBy: "Тест: Старший локації",
        enteredVia: "web",
        note: null,
        isReversed: false,
        reversalReason: null,
      },
    ],
  },
  {
    ...base,
    id: "o3",
    number: 3470,
    clientCode: "АІ8",
    clientName: "Івент-агенція «Дим»",
    status: "confirmed",
    deliveryMethod: "our_delivery",
    amountDue: "4500.00",
    receivedSum: "0.00",
    remainingSum: "4500.00",
    isPaid: false,
    isPartial: false,
    entries: [],
  },
];

function dayFor(screen: CashPreviewScreen): CashDay {
  const orders = screen === "cash-empty" ? [] : ORDERS;
  return {
    date: TODAY,
    locationId: "preview-kyiv",
    orders,
    summary:
      screen === "cash-empty"
        ? {
            expectedSum: "0.00",
            enteredSum: "0.00",
            differenceSum: "0.00",
            receivedOnDaySum: "0.00",
            byReceiver: [],
          }
        : {
            expectedSum: "7650.00",
            enteredSum: "1900.00",
            differenceSum: "5750.00",
            receivedOnDaySum: "1900.00",
            byReceiver: [
              { name: "Водій Іван", sumReceived: "1000.00" },
              { name: "Тест: Старший локації", sumReceived: "900.00" },
            ],
          },
  };
}

interface CashPreviewProps {
  role: UserRole;
  screen: CashPreviewScreen;
  actions: CashActions;
}

export default function CashPreview({ role, screen, actions }: CashPreviewProps) {
  return (
    <CashPageContent
      day={dayFor(screen)}
      today={TODAY}
      canRecord={role === "owner" || role === "location_lead"}
      canReverse={role === "owner"}
      actions={actions}
    />
  );
}
