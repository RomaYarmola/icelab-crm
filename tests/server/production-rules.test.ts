import { describe, expect, it } from "vitest";
import {
  describeDeliveryPlace,
  isNewForProduction,
  ordersToAutoStart,
  sortProductionQueue,
  summarizeProduction,
  windowStartMinutes,
} from "@/server/production-rules";
import type { OrderStatus } from "@/constants/constants";

describe("екран виробництва: правила (D63, D65, D72)", () => {
  describe("вікно доставки", () => {
    it.each([
      ["10:00-14:00", 600],
      ["9-11", 540],
      ["09.30", 570],
      ["до 12:00", 720],
      ["вранці", null],
      ["", null],
      [null, null],
      ["25:00", null],
    ])("«%s» дає %s", (input, expected) => {
      expect(windowStartMinutes(input)).toBe(expected);
    });
  });

  describe("порядок карток", () => {
    const card = (
      number: number,
      status: OrderStatus,
      timeWindow: string | null,
      isNew = false,
    ) => ({ number, status, timeWindow, isNew });

    it("нові зверху, далі за вікном доставки, запаковані внизу", () => {
      const sorted = sortProductionQueue([
        card(1, "packed", "08:00"),
        card(2, "in_production", "14:00"),
        card(3, "confirmed", "09:00", true),
        card(4, "in_production", "10:00"),
        card(5, "confirmed", "16:00", true),
      ]);
      expect(sorted.map((c) => c.number)).toEqual([3, 5, 4, 2, 1]);
    });

    it("без вікна часу після тих, що з вікном; за однакового часу за номером", () => {
      const sorted = sortProductionQueue([
        card(7, "confirmed", null),
        card(9, "confirmed", "10:00"),
        card(8, "confirmed", "10:00"),
      ]);
      expect(sorted.map((c) => c.number)).toEqual([8, 9, 7]);
    });

    it("запаковане замовлення, навіть непобачене, лишається внизу", () => {
      const sorted = sortProductionQueue([
        card(1, "packed", "08:00", true),
        card(2, "confirmed", "20:00"),
      ]);
      expect(sorted.map((c) => c.number)).toEqual([2, 1]);
    });

    it("вхідний масив не змінюється", () => {
      const input = [card(2, "confirmed", "10:00"), card(1, "confirmed", "09:00")];
      sortProductionQueue(input);
      expect(input.map((c) => c.number)).toEqual([2, 1]);
    });
  });

  describe("«Нове»", () => {
    it("нове, поки цех не бачив; запаковане нове не буває", () => {
      expect(isNewForProduction({ status: "confirmed", seenByProductionAt: null })).toBe(true);
      expect(isNewForProduction({ status: "confirmed", seenByProductionAt: new Date() })).toBe(
        false,
      );
      expect(isNewForProduction({ status: "packed", seenByProductionAt: null })).toBe(false);
    });
  });

  describe("підсумок за типами льоду", () => {
    const row = (status: OrderStatus, ice: string, kg: string) => ({
      status,
      iceTypeId: ice,
      iceTypeName: ice === "a" ? "16 мм" : "3 мм",
      kgToProduce: kg,
    });

    it("рахує кг на день і те, що ще не запаковано, та скільки не розпочато", () => {
      const summary = summarizeProduction([
        row("confirmed", "a", "33.000"),
        row("in_production", "a", "22.500"),
        row("packed", "a", "10.000"),
        row("confirmed", "b", "12.000"),
        row("cancelled", "b", "99.000"),
      ]);
      expect(summary.byIce).toEqual([
        { iceTypeId: "b", iceTypeName: "3 мм", kgPlanned: 12, kgLeft: 12, orders: 1 },
        { iceTypeId: "a", iceTypeName: "16 мм", kgPlanned: 65.5, kgLeft: 55.5, orders: 3 },
      ]);
      expect(summary).toMatchObject({ notStarted: 2, notPacked: 3 });
    });

    it("дробові кг не дають помилок додавання", () => {
      const summary = summarizeProduction([
        row("confirmed", "a", "0.1"),
        row("confirmed", "a", "0.2"),
      ]);
      expect(summary.byIce[0]?.kgPlanned).toBe(0.3);
    });

    it("порожній день дає порожній підсумок", () => {
      expect(summarizeProduction([])).toEqual({ byIce: [], notStarted: 0, notPacked: 0 });
    });
  });

  describe("автоматичне «У виробництві» (D72)", () => {
    const orders = [
      { id: "a", status: "confirmed" as const, orderDate: "2026-11-13" },
      { id: "b", status: "confirmed" as const, orderDate: "2026-11-14" },
      { id: "c", status: "in_production" as const, orderDate: "2026-11-13" },
      { id: "d", status: "draft" as const, orderDate: "2026-11-13" },
    ];

    it("цех і старший локації запускають лише підтверджені на сьогодні", () => {
      for (const role of ["production", "location_lead"]) {
        expect(ordersToAutoStart(orders, "2026-11-13", role).map((o) => o.id)).toEqual(["a"]);
      }
    });

    it("власник, менеджер, бухгалтер і водій нічого не запускають", () => {
      for (const role of ["owner", "manager", "accountant", "driver"]) {
        expect(ordersToAutoStart(orders, "2026-11-13", role)).toEqual([]);
      }
    });
  });
});

describe("куди їде замовлення (ТЗ 6.4)", () => {
  const address = {
    cityText: "Київ",
    addressText: "вул. Сагайдачного, 12",
    npWarehouseNumber: "7",
  };

  it("самовивіз, навіть якщо адреса є", () => {
    expect(describeDeliveryPlace({ deliveryMethod: "pickup", deliveryText: null, address })).toBe(
      "Самовивіз",
    );
  });

  it("Нова Пошта: місто й відділення", () => {
    expect(
      describeDeliveryPlace({
        deliveryMethod: "np",
        deliveryText: null,
        address: { cityText: "Харків", addressText: null, npWarehouseNumber: "7" },
      }),
    ).toBe("Харків, відділення №7");
  });

  it("наша доставка: місто й адреса, без номера відділення", () => {
    expect(
      describeDeliveryPlace({ deliveryMethod: "our_delivery", deliveryText: null, address }),
    ).toBe("Київ, вул. Сагайдачного, 12");
  });

  it("вільний текст із замовлення має перевагу над адресою клієнта", () => {
    expect(
      describeDeliveryPlace({
        deliveryMethod: "bus",
        deliveryText: " Автостанція, платформа 3 ",
        address,
      }),
    ).toBe("Автостанція, платформа 3");
  });

  it("без адреси: «Адресу не вказано»", () => {
    expect(describeDeliveryPlace({ deliveryMethod: "np", deliveryText: null, address: null })).toBe(
      "Адресу не вказано",
    );
    expect(
      describeDeliveryPlace({
        deliveryMethod: "other",
        deliveryText: "  ",
        address: { cityText: null, addressText: null, npWarehouseNumber: null },
      }),
    ).toBe("Адресу не вказано");
  });
});
