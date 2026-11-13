import { ORDER_STATUS_ORDER } from "@/constants/orders";
import type { OrderStatus } from "@/constants/constants";
import type { LoadMoreOrdersResult } from "@/app/(app)/orders/actions";
import type { orderItems, orderPriceChanges, orders, orderStatusHistory } from "@/db/schema";
import { canDeleteDraft, editPolicy, transitionOptions } from "@/server/order-rules";
import {
  type OrderListItem,
  toOrderCardView,
  toOrderHistoryItem,
  toOrderListItem,
  toPriceChangeView,
} from "@/server/order-views";
import { can, type UserRole } from "@/server/permissions";
import type { FormState } from "@/utils/formState";
import { cashLinkFor } from "@/utils/cashLink";
import { parseOrderListParams } from "@/utils/orderListParams";
import OrderCardContent from "../ordersPage/OrderCardContent";
import OrderFormContent from "../ordersPage/OrderFormContent";
import { buildCreateDefaults, buildEditDefaults } from "../ordersPage/orderFormDefaults";
import type { OrderFormActions, OrderFormOptions } from "../ordersPage/orderFormTypes";
import OrdersPageContent from "../ordersPage/OrdersPageContent";

/**
 * Екрани замовлень з вигаданими даними для перегляду `/ui-kit/shell/<роль>?screen=…`. Картки
 * збирає той самий код, що й на сервері (`toOrderCardView`), тож роль бачить рівно те, що побачить
 * у справжньому застосунку: старший локації без грошей, внутрішній коментар лише в офісних ролей.
 */

export const ORDER_PREVIEW_SCREENS = [
  "order-list",
  "order-list-empty",
  "order",
  "new-order",
  "edit-order",
] as const;
export type OrderPreviewScreen = (typeof ORDER_PREVIEW_SCREENS)[number];

const TODAY = "2026-11-12";

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;
type HistoryRow = typeof orderStatusHistory.$inferSelect;
type ChangeRow = typeof orderPriceChanges.$inferSelect;

const NAMES = {
  clientCode: "АА15",
  clientName: "Кафе «Вогник»",
  locationName: "Київ",
  iceTypeName: "16 мм",
  sourceName: "Телефон",
  boxTypeName: "Наш довгий 46 л",
  addressText: "Київ, вул. Сагайдачного, 12",
};

function orderRow(status: OrderStatus, overrides: Partial<OrderRow> = {}): OrderRow {
  const confirmed = status !== "draft" && status !== "cancelled";
  const at = (iso: string) => new Date(iso);
  return {
    id: "o1",
    number: 3472,
    locationId: "preview-kyiv",
    clientId: "c1",
    status,
    sourceId: "src-phone",
    orderDate: "2026-11-13",
    iceTypeId: "ice-16",
    kgSold: "30.000",
    kgToProduce: "33.000",
    markupPercentApplied: "10.00",
    pricePerKgSnapshot: confirmed ? "75.00" : null,
    priceManual: false,
    deliveryMethod: "np",
    addressId: "ad1",
    deliveryText: null,
    timeWindow: "10:00-14:00",
    recipientName: "Марія Петренко",
    recipientPhone: "+380501234567",
    boxTypeId: "box-46",
    boxCount: 2,
    boxOwnership: "ours",
    comment: "Пакувати в два бокси, привезти до 10:00.",
    internalComment: "Постійний клієнт, знижка за домовленістю.",
    paymentKind: "fop",
    total: "2400.00",
    confirmedAt: confirmed ? at("2026-11-12T09:00:00Z") : null,
    confirmedBy: null,
    producedAt: null,
    packedAt: null,
    shippedAt: null,
    paidAt: status === "paid" || status === "closed" ? at("2026-11-13T15:00:00Z") : null,
    closedAt: status === "closed" ? at("2026-11-13T15:00:01Z") : null,
    seenByProductionAt: null,
    telegramMessageId: null,
    telegramChatId: null,
    draftPayload: null,
    duplicateOf: null,
    cancelReason: status === "cancelled" ? "Клієнт передумав." : null,
    isArchive: false,
    deletedAt: null,
    createdBy: null,
    createdAt: at("2026-11-12T08:00:00Z"),
    updatedAt: at("2026-11-12T08:00:00Z"),
    ...overrides,
  };
}

const ITEMS: ItemRow[] = [
  {
    id: "i1",
    orderId: "o1",
    kind: "ice",
    title: "Лід 16 мм",
    qty: "30.000",
    unit: "кг",
    price: "75.00",
    amount: "2250.00",
    boxTypeId: null,
    createdBy: null,
    createdAt: new Date("2026-11-12T08:00:00Z"),
    updatedAt: new Date("2026-11-12T08:00:00Z"),
  },
  {
    id: "i2",
    orderId: "o1",
    kind: "delivery",
    title: "Доставка по Києву",
    qty: "1.000",
    unit: "послуга",
    price: "150.00",
    amount: "150.00",
    boxTypeId: null,
    createdBy: null,
    createdAt: new Date("2026-11-12T08:01:00Z"),
    updatedAt: new Date("2026-11-12T08:01:00Z"),
  },
];

const STEPS: [OrderStatus | null, OrderStatus, string, string | null][] = [
  [null, "draft", "2026-11-12T08:00:00Z", null],
  ["draft", "confirmed", "2026-11-12T09:00:00Z", null],
  ["confirmed", "in_production", "2026-11-13T06:30:00Z", null],
  ["in_production", "packed", "2026-11-13T08:10:00Z", null],
  ["packed", "shipped", "2026-11-13T09:00:00Z", null],
  ["shipped", "paid", "2026-11-13T15:00:00Z", "Готівка в касі"],
  ["paid", "closed", "2026-11-13T15:00:01Z", "Закрито автоматично: замовлення оплачене"],
];

function historyFor(status: OrderStatus): HistoryRow[] {
  const reached =
    status === "cancelled"
      ? STEPS.slice(0, 2)
      : STEPS.slice(0, STEPS.findIndex((step) => step[1] === status) + 1);
  const rows = reached.map(([from, to, at, note], index) => ({
    id: `h${index}`,
    orderId: "o1",
    fromStatus: from,
    toStatus: to,
    changedBy: null,
    changedAt: new Date(at),
    note,
  }));
  if (status === "cancelled") {
    rows.push({
      id: "h-cancel",
      orderId: "o1",
      fromStatus: "confirmed",
      toStatus: "cancelled",
      changedBy: null,
      changedAt: new Date("2026-11-12T12:00:00Z"),
      note: "Клієнт передумав.",
    });
  }
  return rows;
}

const CHANGES: ChangeRow[] = [
  {
    id: "pc1",
    orderId: "o1",
    oldPrice: "75.00",
    newPrice: "70.00",
    note: "Домовились про знижку на постійне замовлення.",
    changedBy: null,
    changedAt: new Date("2026-11-12T11:00:00Z"),
  },
];

const LIST_ROWS: [OrderStatus, string, string, string, Partial<OrderRow>][] = [
  ["in_production", "АА15", "Кафе «Вогник»", "ice-16", { number: 3472 }],
  [
    "confirmed",
    "ВС57",
    "ФОП Іваненко Петро Олексійович",
    "ice-3",
    {
      number: 3471,
      deliveryMethod: "pickup",
      kgSold: "12.000",
      kgToProduce: "12.000",
      total: "900.00",
    },
  ],
  [
    "draft",
    "АІ8",
    "Івент-агенція «Дим»",
    "ice-19",
    { number: 3470, kgSold: "60.000", kgToProduce: "66.000", total: "4500.00" },
  ],
  [
    "packed",
    "21",
    "Склад №4",
    "ice-16",
    { number: 3469, deliveryMethod: "our_delivery", total: "1875.00" },
  ],
];

function listItems(role: UserRole): OrderListItem[] {
  return LIST_ROWS.map(([status, code, name, , overrides], index) =>
    toOrderListItem(
      orderRow(status, { id: `o${index + 1}`, ...overrides }),
      { clientCode: code, clientName: name, locationName: "Київ", iceTypeName: "16 мм" },
      role,
    ),
  );
}

const FORM_OPTIONS: OrderFormOptions = {
  locations: [
    { id: "preview-kyiv", name: "Київ" },
    { id: "preview-lviv", name: "Львів" },
  ],
  iceTypes: [
    { id: "ice-3", name: "3 мм" },
    { id: "ice-16", name: "16 мм" },
    { id: "ice-19", name: "19 мм" },
  ],
  sources: [
    { id: "src-phone", name: "Телефон" },
    { id: "src-site", name: "Сайт" },
  ],
  boxTypes: [{ id: "box-46", name: "Наш довгий 46 л" }],
};

interface OrdersPreviewProps {
  role: UserRole;
  screen: OrderPreviewScreen;
  /** Статус для екрана `order` (`?status=`): чернетка за замовчуванням. */
  status: string | undefined;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  loadMore: () => Promise<LoadMoreOrdersResult>;
  /** Підказки форми замовлення (заглушки каталогу). */
  formActions: Omit<OrderFormActions, "submit">;
}

export default function OrdersPreview({
  role,
  screen,
  status,
  action,
  loadMore,
  formActions,
}: OrdersPreviewProps) {
  if (screen === "order-list" || screen === "order-list-empty") {
    return (
      <OrdersPageContent
        page={{
          items: screen === "order-list" ? listItems(role) : [],
          hasMore: screen === "order-list",
        }}
        filters={parseOrderListParams({ day: "week" }, TODAY)}
        managers={[{ id: "mgr-1", name: "Олена Коваль" }]}
        canCreate={can(role, "orders", "write") && role !== "location_lead"}
        loadMore={loadMore}
      />
    );
  }

  const current = ORDER_STATUS_ORDER.find((item) => item === status) ?? "draft";
  const isOffice = role === "owner" || role === "manager";
  const policy = editPolicy(current, role);

  if (screen === "new-order") {
    return (
      <OrderFormContent
        mode="create"
        options={FORM_OPTIONS}
        defaults={buildCreateDefaults({ today: TODAY, locationId: "preview-kyiv" })}
        initialClient={null}
        canSeeInternal={isOffice}
        actions={{ submit: action, ...formActions }}
      />
    );
  }

  const changesVisible = current !== "draft" && current !== "cancelled";
  const order = toOrderCardView(
    orderRow(current),
    NAMES,
    ITEMS,
    historyFor(current).map((row) =>
      toOrderHistoryItem(row, row.id === "h0" ? "Олена Коваль" : null),
    ),
    changesVisible ? CHANGES.map((row) => toPriceChangeView(row, "Олена Коваль")) : [],
    role,
  );

  if (screen === "edit-order") {
    return (
      <OrderFormContent
        mode="edit"
        orderId={order.id}
        orderNumber={order.number}
        options={FORM_OPTIONS}
        defaults={buildEditDefaults(order)}
        initialClient={{ id: order.clientId, code: order.clientCode, name: order.clientName }}
        policy={policy}
        currentPrice={order.pricePerKgSnapshot ?? order.items[0]?.price ?? null}
        canSeeInternal={order.internalComment !== undefined}
        actions={{ submit: action, ...formActions }}
      />
    );
  }

  return (
    <OrderCardContent
      order={order}
      transitions={transitionOptions(current, role)}
      permissions={{
        canOverridePrice: can(role, "order_price_override", "write"),
        canDeleteDraft: canDeleteDraft(current, role),
        canEdit:
          policy.core !== "none" || policy.produce || policy.comment || policy.internalComment,
        canEditItems: isOffice && policy.core !== "none",
        itemsNeedNote: policy.core === "owner_note",
      }}
      cashHref={cashLinkFor(role, order)}
      notice={current === "draft" ? "created" : undefined}
      actions={{
        transition: action,
        changePrice: action,
        remove: action,
        addItem: action,
        updateItem: action,
        deleteItem: action,
      }}
    />
  );
}
