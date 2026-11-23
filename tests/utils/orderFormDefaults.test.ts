import { describe, expect, it } from "vitest";
import { buildCreateDefaults, buildEditDefaults } from "@/components/ordersPage/orderFormDefaults";
import type { OrderCardView } from "@/server/order-views";

describe("початкові значення форми замовлення", () => {
  it("нове замовлення: сьогоднішня дата, вибрана локація, решта порожня чи за замовчуванням", () => {
    expect(buildCreateDefaults({ today: "2026-11-13", locationId: "loc-1" })).toEqual({
      locationId: "loc-1",
      orderDate: "2026-11-13",
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
      boxLines: [],
      boxSales: [],
      boxOwnership: "ours",
      paymentKind: "unknown",
      comment: "",
      internalComment: "",
    });
  });

  const order = {
    locationId: "loc-1",
    orderDate: "2026-11-13",
    iceTypeId: "ice-16",
    kgSold: "30.000",
    kgToProduce: "33.000",
    sourceId: null,
    deliveryMethod: "np",
    addressId: "ad1",
    deliveryText: null,
    timeWindow: "10:00-14:00",
    recipientName: "Марія",
    recipientPhone: "+380501234567",
    boxTypeId: null,
    boxCount: 2,
    boxLines: [
      { name: "Міні 9 л", count: 2, boxTypeId: "box-9", clientOwnBoxId: null, isClient: false },
    ],
    items: [
      { id: "i1", kind: "box_sale", boxTypeId: "box-46", qty: "2.000", price: "650.00" },
      { id: "i2", kind: "ice", boxTypeId: null, qty: "30.000", price: "75.00" },
    ],
    boxOwnership: "ours",
    paymentKind: "fop",
    comment: "До 10:00",
    internalComment: "Постійний клієнт",
  } as unknown as OrderCardView;

  it("зміна: кілограми без нулів, телефон у зручному вигляді, порожнє як порожній рядок", () => {
    expect(buildEditDefaults(order)).toMatchObject({
      kgSold: "30",
      kgToProduce: "33",
      sourceId: "",
      deliveryText: "",
      boxLines: [{ key: 1, owner: "ours", boxTypeId: "box-9", clientOwnBoxId: "", count: "2" }],
      boxSales: [{ key: 1, boxTypeId: "box-46", qty: "2", price: "650" }],
      recipientPhone: "+38 050 123 45 67",
      paymentKind: "fop",
      internalComment: "Постійний клієнт",
    });
  });

  it("поля, яких роль не отримала (спосіб оплати, внутрішній коментар), стають порожніми значеннями", () => {
    const limited = {
      ...order,
      paymentKind: undefined,
      internalComment: undefined,
    } as unknown as OrderCardView;
    expect(buildEditDefaults(limited)).toMatchObject({
      paymentKind: "unknown",
      internalComment: "",
    });
  });
});
