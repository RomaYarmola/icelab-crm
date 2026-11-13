import type { OrderCardView } from "@/server/order-views";
import { parseDecimal } from "@/utils/orderMath";
import { formatPhone } from "@/utils/phone";
import type { OrderFormValues } from "./orderFormTypes";

/** Початкові значення форми нового замовлення: дата й локація, решта порожня чи за замовчуванням. */
export function buildCreateDefaults(input: { today: string; locationId: string }): OrderFormValues {
  return {
    locationId: input.locationId,
    orderDate: input.today,
    iceTypeId: "",
    kgSold: "",
    kgToProduce: "",
    sourceId: "",
    deliveryMethod: "pickup",
    addressId: "",
    deliveryText: "",
    timeWindow: "",
    recipientName: "",
    recipientPhone: "",
    boxTypeId: "",
    boxCount: "0",
    boxOwnership: "ours",
    paymentKind: "unknown",
    comment: "",
    internalComment: "",
  };
}

/** Початкові значення форми зміни з картки замовлення (поля, яких роль не отримала, порожні). */
export function buildEditDefaults(order: OrderCardView): OrderFormValues {
  const kg = (value: string) => String(parseDecimal(value));
  return {
    locationId: order.locationId,
    orderDate: order.orderDate,
    iceTypeId: order.iceTypeId ?? "",
    kgSold: kg(order.kgSold),
    kgToProduce: kg(order.kgToProduce),
    sourceId: order.sourceId ?? "",
    deliveryMethod: order.deliveryMethod,
    addressId: order.addressId ?? "",
    deliveryText: order.deliveryText ?? "",
    timeWindow: order.timeWindow ?? "",
    recipientName: order.recipientName ?? "",
    recipientPhone: order.recipientPhone ? formatPhone(order.recipientPhone) : "",
    boxTypeId: order.boxTypeId ?? "",
    boxCount: String(order.boxCount),
    boxOwnership: order.boxOwnership,
    paymentKind: order.paymentKind ?? "unknown",
    comment: order.comment ?? "",
    internalComment: order.internalComment ?? "",
  };
}
