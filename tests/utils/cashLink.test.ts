import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@/server/permissions";
import { cashLinkFor } from "@/utils/cashLink";

const order = {
  id: "o1",
  orderDate: "2026-11-13",
  status: "shipped",
  paymentKind: "cash" as const,
};

describe("кнопка «Готівка» на картці замовлення", () => {
  it("є лише в ролей, що читають готівку: власник, менеджер, бухгалтер, старший локації", () => {
    for (const role of USER_ROLES) {
      const link = cashLinkFor(role, order);
      if (["owner", "manager", "accountant", "location_lead"].includes(role)) {
        expect(link, role).toBe("/more/cash?date=2026-11-13#order-o1");
      } else {
        expect(link, role).toBeNull();
      }
    }
  });

  it("лише для готівкових підтверджених замовлень", () => {
    expect(cashLinkFor("owner", { ...order, paymentKind: "fop" })).toBeNull();
    expect(cashLinkFor("owner", { ...order, paymentKind: undefined })).toBeNull();
    expect(cashLinkFor("owner", { ...order, status: "draft" })).toBeNull();
    expect(cashLinkFor("owner", { ...order, status: "cancelled" })).toBeNull();
    for (const status of ["confirmed", "in_production", "packed", "shipped", "paid", "closed"]) {
      expect(cashLinkFor("owner", { ...order, status }), status).not.toBeNull();
    }
  });
});
