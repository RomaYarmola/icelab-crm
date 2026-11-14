import { describe, expect, it } from "vitest";
import { describeMapQuery } from "@/server/production-rules";
import { mapRouteUrl, mapSearchUrl, telHref } from "@/utils/mapLinks";

describe("дзвінок і карта на картці цеху (D118)", () => {
  it("tel лише для коректного номера E.164", () => {
    expect(telHref("+380501234567")).toBe("tel:+380501234567");
    expect(telHref("0501234567")).toBeNull();
    expect(telHref("+380 50 123 45 67")).toBeNull();
    expect(telHref("tel:+38050")).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it("посилання на Google Maps: пошук місця й маршрут, адреса закодована", () => {
    const q = "Київ, вул. Сагайдачного, 12 & кафе";
    expect(mapSearchUrl(q)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
    );
    expect(mapRouteUrl(q)).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`,
    );
    expect(mapSearchUrl(q)).not.toContain(" ");
    expect(mapSearchUrl(q)).not.toContain("&кафе");
  });

  it("що шукати на карті: адреса з містом, відділення Нової Пошти, без адреси чи самовивіз нічого", () => {
    const base = { deliveryText: null, address: null } as const;
    expect(describeMapQuery({ ...base, deliveryMethod: "pickup" })).toBeNull();
    expect(describeMapQuery({ ...base, deliveryMethod: "our_delivery" })).toBeNull();
    expect(
      describeMapQuery({
        deliveryMethod: "our_delivery",
        deliveryText: null,
        address: {
          cityText: "Київ",
          addressText: "вул. Сагайдачного, 12",
          npWarehouseNumber: null,
        },
      }),
    ).toBe("вул. Сагайдачного, 12, Київ");
    expect(
      describeMapQuery({
        deliveryMethod: "our_delivery",
        deliveryText: "Київ, Подільська 5",
        address: null,
      }),
    ).toBe("Київ, Подільська 5");
    expect(
      describeMapQuery({
        deliveryMethod: "np",
        deliveryText: null,
        address: { cityText: "Харків", addressText: null, npWarehouseNumber: "7" },
      }),
    ).toBe("Нова Пошта, відділення №7, Харків");
  });
});
