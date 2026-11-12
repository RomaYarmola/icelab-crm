import type { OrderStatus } from "@/constants/constants";
import type { orderItems, orderPriceChanges, orderStatusHistory, orders } from "@/db/schema";
import { type OrderItemView, type OrderView, toOrderItemView, toOrderView } from "./dto";
import { can, type UserRole } from "./permissions";

/**
 * Подання замовлень для відповідей сервера (B5). Поля беремо за списком дозволених у `dto.ts`: ціни
 * й суми лише ролям з правом `order_money` (власник, менеджер, бухгалтер), внутрішній коментар
 * лише власнику й менеджеру. Старший локації і виробництво грошей не отримують ніде: ні в списку,
 * ні в картці, ні в позиціях, ні в історії змін ціни.
 */

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type HistoryRow = typeof orderStatusHistory.$inferSelect;
type PriceChangeRow = typeof orderPriceChanges.$inferSelect;

/** Рядок списку замовлень. Сума лише для ролей з правом на гроші. */
export type OrderListItem = {
  id: string;
  number: number | null;
  clientId: string;
  clientCode: string;
  clientName: string;
  locationId: string;
  locationName: string;
  status: OrderStatus;
  orderDate: string;
  iceTypeName: string | null;
  kgSold: string;
  kgToProduce: string;
  deliveryMethod: OrderRow["deliveryMethod"];
  total?: string;
};

export type OrderListNames = {
  clientCode: string;
  clientName: string;
  locationName: string;
  iceTypeName: string | null;
};

export function toOrderListItem(
  row: OrderRow,
  names: OrderListNames,
  role: UserRole,
): OrderListItem {
  const item: OrderListItem = {
    id: row.id,
    number: row.number,
    clientId: row.clientId,
    clientCode: names.clientCode,
    clientName: names.clientName,
    locationId: row.locationId,
    locationName: names.locationName,
    status: row.status,
    orderDate: row.orderDate,
    iceTypeName: names.iceTypeName,
    kgSold: row.kgSold,
    kgToProduce: row.kgToProduce,
    deliveryMethod: row.deliveryMethod,
  };
  if (can(role, "order_money", "read")) item.total = row.total;
  return item;
}

/** Запис історії статусів: хто, коли, що змінив і чому. Грошей тут немає. */
export type OrderHistoryItem = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedAt: Date;
  changedByName: string | null;
  note: string | null;
};

export function toOrderHistoryItem(
  row: HistoryRow,
  changedByName: string | null,
): OrderHistoryItem {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedAt: row.changedAt,
    changedByName,
    note: row.note,
  };
}

/** Зміна ціни підтвердженого замовлення. Гроші: лише для ролей з правом на суми. */
export type PriceChangeView = {
  id: string;
  oldPrice: string;
  newPrice: string;
  note: string;
  changedAt: Date;
  changedByName: string | null;
};

export function toPriceChangeView(
  row: PriceChangeRow,
  changedByName: string | null,
): PriceChangeView {
  return {
    id: row.id,
    oldPrice: row.oldPrice,
    newPrice: row.newPrice,
    note: row.note,
    changedAt: row.changedAt,
    changedByName,
  };
}

/** Імена зі зв'язаних довідників (їх додає запит, у замовленні лише ідентифікатори). */
export type OrderNames = OrderListNames & {
  sourceName: string | null;
  boxTypeName: string | null;
  /** Адреса клієнта, вибрана в замовленні, одним рядком. */
  addressText: string | null;
};

/** Картка замовлення: поля за роллю, імена довідників, позиції, історія, зміни ціни за правом. */
export type OrderCardView = OrderView &
  OrderNames & {
    items: OrderItemView[];
    history: OrderHistoryItem[];
    /** Є лише у ролей з правом на гроші. */
    priceChanges?: PriceChangeView[];
  };

export function toOrderCardView(
  order: OrderRow,
  names: OrderNames,
  items: OrderItemRow[],
  history: OrderHistoryItem[],
  priceChanges: PriceChangeView[] | null,
  role: UserRole,
): OrderCardView {
  const view: OrderCardView = {
    ...toOrderView(order, role),
    ...names,
    items: items.map((item) => toOrderItemView(item, role)),
    history,
  };
  // Подвійний захист: зміни ціни додаємо лише коли роль має право, навіть якщо їх передали.
  if (priceChanges && can(role, "order_money", "read")) view.priceChanges = priceChanges;
  return view;
}
