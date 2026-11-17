import { describe, expect, it } from "vitest";
import {
  normalizeNpPhone,
  npDate,
  shipmentBlockers,
  shipmentParams,
  splitRecipientName,
  type ShipmentPrerequisites,
} from "@/server/np/shipment-rules";

const ready = (): ShipmentPrerequisites => ({
  order: {
    status: "confirmed",
    deliveryMethod: "np",
    recipientName: "Коваль Олена",
    recipientPhone: "+380501234567",
    kgToProduce: "33.000",
    boxCount: 2,
    total: "1800.00",
  },
  address: { kind: "np_warehouse", isResolved: true, npCityRef: "c", npWarehouseRef: "w" },
  senderReady: true,
  hasActiveShipment: false,
});

describe("правила накладної Нової Пошти (B10, D127, D128)", () => {
  it("усе готово: причин немає", () => {
    expect(shipmentBlockers(ready())).toEqual([]);
  });

  it("статуси: можна від «Підтверджено» до «Запаковано», чернетку й далі ні", () => {
    for (const status of ["confirmed", "in_production", "packed"]) {
      const input = ready();
      input.order.status = status;
      expect(shipmentBlockers(input), status).toEqual([]);
    }
    for (const status of ["draft", "shipped", "paid", "closed", "cancelled"]) {
      const input = ready();
      input.order.status = status;
      expect(shipmentBlockers(input).join(" "), status).toContain("від «Підтверджено»");
    }
  });

  it("кожна відсутня умова дає свою причину", () => {
    const cases: [(i: ShipmentPrerequisites) => void, string][] = [
      [(i) => (i.order.deliveryMethod = "pickup"), "не «Нова Пошта»"],
      [(i) => (i.address = null), "немає адреси"],
      [(i) => (i.address = { ...i.address!, kind: "delivery" }), "не належить Новій Пошті"],
      [
        (i) => (i.address = { ...i.address!, kind: "np_address" }),
        "за адресою поки не підтримуємо",
      ],
      [(i) => (i.address = { ...i.address!, isResolved: false }), "потребує уточнення"],
      [(i) => (i.address = { ...i.address!, npWarehouseRef: null }), "потребує уточнення"],
      [(i) => (i.order.recipientPhone = "0501234567"), "телефон одержувача"],
      [(i) => (i.order.recipientPhone = null), "телефон одержувача"],
      [(i) => (i.senderReady = false), "відправника"],
      [(i) => (i.order.kgToProduce = "0"), "вагу замовлення"],
      [(i) => (i.order.total = "0"), "оголошена вартість"],
      [(i) => (i.hasActiveShipment = true), "вже є"],
    ];
    for (const [mutate, expected] of cases) {
      const input = ready();
      mutate(input);
      expect(shipmentBlockers(input).join(" "), expected).toContain(expected);
    }
  });

  it("телефон: +380 і цифри, пробіли й дужки ігноруються", () => {
    expect(normalizeNpPhone("+380 (50) 123-45-67")).toBe("380501234567");
    expect(normalizeNpPhone("380501234567")).toBe("380501234567");
    expect(normalizeNpPhone("0501234567")).toBeNull();
    expect(normalizeNpPhone("+3805012345")).toBeNull();
    expect(normalizeNpPhone(null)).toBeNull();
  });

  it("ім'я одержувача: прізвище, ім'я, по батькові; одного слова замало", () => {
    expect(splitRecipientName("Коваль Олена Іванівна")).toEqual({
      lastName: "Коваль",
      firstName: "Олена",
      middleName: "Іванівна",
    });
    expect(splitRecipientName("  Коваль   Олена ")).toEqual({
      lastName: "Коваль",
      firstName: "Олена",
      middleName: "",
    });
    expect(splitRecipientName("Олена")).toBeNull();
    expect(splitRecipientName("")).toBeNull();
    expect(splitRecipientName(null)).toBeNull();
    expect(splitRecipientName("О'Брайен Ірина")?.lastName).toBe("О'Брайен");
  });

  it("вага = лід + порожні бокси, місць стільки, скільки боксів (мінімум 1)", () => {
    expect(shipmentParams({ kgToProduce: "33.000", boxCount: 2, emptyWeightKg: "1.500" })).toEqual({
      weightKg: 36,
      emptyBoxesKg: 3,
      seats: 2,
      emptyWeightKnown: true,
    });
    // Вага бокса невідома: лише лід і застереження.
    expect(shipmentParams({ kgToProduce: "33.000", boxCount: 2, emptyWeightKg: null })).toEqual({
      weightKg: 33,
      emptyBoxesKg: 0,
      seats: 2,
      emptyWeightKnown: false,
    });
    // Без боксів одне місце, застереження не потрібне.
    expect(
      shipmentParams({ kgToProduce: "5.000", boxCount: 0, emptyWeightKg: null }),
    ).toMatchObject({
      weightKg: 5,
      seats: 1,
      emptyWeightKnown: true,
    });
  });

  it("дата: не раніше за сьогодні, формат дд.мм.рррр", () => {
    expect(npDate("2026-11-20", "2026-11-17")).toBe("20.11.2026");
    expect(npDate("2026-11-10", "2026-11-17")).toBe("17.11.2026");
  });
});
