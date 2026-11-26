import type { OrderCardView } from "@/server/order-views";
import { parseDecimal, sumAmounts } from "@/utils/orderMath";
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
    deliveryPrice: "",
    addressId: "",
    deliveryText: "",
    timeWindow: "",
    recipientName: "",
    recipientPhone: "",
    boxLines: [],
    boxSales: [],
    products: [],
    boxOwnership: "ours",
    paymentKind: "unknown",
    comment: "",
    internalComment: "",
  };
}

/** Сума позицій «Доставка» (порожньо, якщо їх немає чи роль не бачить грошей). */
function deliveryPriceOf(order: OrderCardView): string {
  const amounts = order.items.flatMap((item) =>
    item.kind === "delivery" && item.amount !== undefined ? [item.amount] : [],
  );
  return amounts.length > 0 ? String(parseDecimal(sumAmounts(amounts))) : "";
}

/** Початкові значення форми зміни з картки замовлення (поля, яких роль не отримала, порожні). */
export function buildEditDefaults(
  order: OrderCardView,
  /** Товари без типів: щоб упізнати їхні позиції в замовленні. */
  productOptions: { id: string; code: string }[] = [],
): OrderFormValues {
  const kg = (value: string) => String(parseDecimal(value));
  return {
    locationId: order.locationId,
    orderDate: order.orderDate,
    iceTypeId: order.iceTypeId ?? "",
    kgSold: kg(order.kgSold),
    kgToProduce: kg(order.kgToProduce),
    sourceId: order.sourceId ?? "",
    deliveryMethod: order.deliveryMethod,
    deliveryPrice: deliveryPriceOf(order),
    addressId: order.addressId ?? "",
    deliveryText: order.deliveryText ?? "",
    timeWindow: order.timeWindow ?? "",
    recipientName: order.recipientName ?? "",
    recipientPhone: order.recipientPhone ? formatPhone(order.recipientPhone) : "",
    products: order.items.flatMap((item, index) => {
      const product = productOptions.find((candidate) => candidate.id === item.productId);
      return product
        ? [
            {
              key: index + 1,
              code: product.code,
              qty: String(parseDecimal(item.qty)),
              price: item.price ? String(parseDecimal(item.price)) : "",
            },
          ]
        : [];
    }),
    boxSales: order.items
      .filter((item) => item.kind === "box_sale" && item.boxTypeId)
      .map((item, index) => ({
        key: index + 1,
        boxTypeId: item.boxTypeId ?? "",
        qty: String(parseDecimal(item.qty)),
        price: item.price ? String(parseDecimal(item.price)) : "",
      })),
    boxLines: order.boxLines.map((line, index) => ({
      key: index + 1,
      owner: line.isClient ? ("client" as const) : ("ours" as const),
      boxTypeId: line.boxTypeId ?? "",
      clientOwnBoxId: line.clientOwnBoxId ?? "",
      count: String(line.count),
    })),
    boxOwnership: order.boxOwnership,
    paymentKind: order.paymentKind ?? "unknown",
    comment: order.comment ?? "",
    internalComment: order.internalComment ?? "",
  };
}
