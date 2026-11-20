import { describe, expect, it } from "vitest";
import {
  normalizeNpPhone,
  boxSpec,
  npDate,
  volumetricWeightKg,
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

  it("тара рядками: вага й місця сумуються за рядками (mini + довгий)", () => {
    const params = shipmentParams({
      kgToProduce: "30.000",
      boxCount: 0,
      emptyWeightKg: null,
      lines: [
        { count: 1, emptyWeightKg: "0.6", dimensions: null },
        { count: 1, emptyWeightKg: null, dimensions: null },
      ],
    });
    // 30 + 0,6 + 1 (типова для невідомої ваги) = 31,6; місць 2; вага бокса відома не скрізь.
    expect(params).toMatchObject({ weightKg: 31.6, seats: 2, emptyWeightKnown: false });
  });

  it("кур'єрська відправка Новою Поштою поки блокується (D167)", () => {
    const input = ready();
    input.order.npDeliveryKind = "courier";
    expect(shipmentBlockers(input).join(" ")).toContain("кур'єром поки не підтримуємо");
    input.order.npDeliveryKind = "warehouse";
    expect(shipmentBlockers(input)).toEqual([]);
  });

  it("вага = лід + порожні бокси, місць стільки, скільки боксів (мінімум 1)", () => {
    expect(shipmentParams({ kgToProduce: "33.000", boxCount: 2, emptyWeightKg: "1.500" })).toEqual({
      weightKg: 36,
      byVolume: false,
      emptyBoxesKg: 3,
      seats: 2,
      emptyWeightKnown: true,
    });
    // Вага бокса невідома: додаємо 1 кг на бокс і показуємо «орієнтовно» (D166).
    expect(shipmentParams({ kgToProduce: "33.000", boxCount: 2, emptyWeightKg: null })).toEqual({
      weightKg: 35,
      byVolume: false,
      emptyBoxesKg: 2,
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

  it("об'ємна вага (D158): 19 л зовні 330×340×410 мм дає 11,5 кг, вага не менша за неї", () => {
    const dimensions = { heightMm: 330, widthMm: 340, lengthMm: 410 };
    expect(volumetricWeightKg(dimensions)).toBeCloseTo(11.5, 1);
    // Лід 5 кг + бокс 0,6 кг менші за об'ємну вагу: у накладну йде об'ємна.
    expect(
      shipmentParams({ kgToProduce: "5.000", boxCount: 1, emptyWeightKg: "0.6", dimensions }),
    ).toMatchObject({ byVolume: true, weightKg: 11.501 });
    // Повний бокс 16 кг важить більше за об'ємну.
    expect(
      shipmentParams({ kgToProduce: "16.000", boxCount: 1, emptyWeightKg: "0.6", dimensions }),
    ).toMatchObject({ byVolume: false, weightKg: 16.6 });
  });

  it("типова вага порожнього бокса береться з налаштування", () => {
    expect(
      shipmentParams({
        kgToProduce: "10.000",
        boxCount: 2,
        emptyWeightKg: null,
        defaultEmptyKg: 1.5,
      }),
    ).toMatchObject({ weightKg: 13, emptyBoxesKg: 3 });
  });

  it("бокс клієнта сильніший за тип тари, розміри лише повним набором", () => {
    const type = { emptyWeightKg: "0.6", heightMm: 300, widthMm: 300, lengthMm: 300 };
    const own = { emptyWeightKg: "2", heightMm: null, widthMm: null, lengthMm: null };
    expect(boxSpec(own, type)).toEqual({
      emptyWeightKg: "2",
      dimensions: { heightMm: 300, widthMm: 300, lengthMm: 300 },
    });
    expect(boxSpec(null, { ...type, widthMm: null })).toEqual({
      emptyWeightKg: "0.6",
      dimensions: null,
    });
  });

  it("дата: не раніше за сьогодні, формат дд.мм.рррр", () => {
    expect(npDate("2026-11-20", "2026-11-17")).toBe("20.11.2026");
    expect(npDate("2026-11-10", "2026-11-17")).toBe("17.11.2026");
  });
});
