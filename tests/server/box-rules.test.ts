import { describe, expect, it } from "vitest";
import {
  applyBoxAction,
  boxCodeSequence,
  canDoBoxAction,
  canIssueBoxesToOrder,
  formatBoxCode,
  parseBoxCode,
  type BoxState,
} from "@/server/box-rules";
import { USER_ROLES } from "@/server/permissions";

const inStock: BoxState = { status: "in_stock", currentClientId: null, currentOrderId: null };
const atClient: BoxState = { status: "at_client", currentClientId: "c1", currentOrderId: "o1" };
const state = (status: BoxState["status"]): BoxState => ({ ...inStock, status });
const order = { id: "o2", clientId: "c2" };

describe("стани бокса (ТЗ 5.2, D106)", () => {
  it("видача: на складі → у клієнта з клієнтом і замовленням", () => {
    const r = applyBoxAction(inStock, "issue", order);
    expect(r).toMatchObject({
      ok: true,
      next: { status: "at_client", currentClientId: "c2", currentOrderId: "o2" },
      events: [{ event: "issued", clientId: "c2", orderId: "o2" }],
    });
    expect((r as { warning?: string }).warning).toBeUndefined();
  });

  it("видача без замовлення, проданого, списаного чи втраченого бокса відхиляється", () => {
    expect(applyBoxAction(inStock, "issue")).toMatchObject({ ok: false });
    for (const status of ["sold", "retired", "lost"] as const) {
      expect(applyBoxAction(state(status), "issue", order), status).toMatchObject({ ok: false });
    }
  });

  it("бокс уже в цьому замовленні: помилка", () => {
    expect(applyBoxAction(atClient, "issue", { id: "o1", clientId: "c1" })).toEqual({
      ok: false,
      error: "Бокс уже у цьому замовленні.",
    });
  });

  it("бокс в іншого клієнта: дозволено з попередженням, неявне повернення пишеться першим", () => {
    const r = applyBoxAction(atClient, "issue", order);
    expect(r).toMatchObject({
      ok: true,
      next: { status: "at_client", currentClientId: "c2", currentOrderId: "o2" },
      events: [
        { event: "returned", clientId: "c1", orderId: "o1" },
        { event: "issued", clientId: "c2", orderId: "o2" },
      ],
    });
    expect((r as { warning: string }).warning).toContain("іншого клієнта");
  });

  it("повернення: у клієнта → на складі, клієнт і замовлення зникають, подія зберігає хто був", () => {
    expect(applyBoxAction(atClient, "return")).toMatchObject({
      ok: true,
      next: { status: "in_stock", currentClientId: null, currentOrderId: null },
      events: [{ event: "returned", clientId: "c1", orderId: "o1" }],
    });
  });

  it("повторний скан повернення бокса на складі: лише примітка, стан без змін", () => {
    const r = applyBoxAction(inStock, "return");
    expect(r).toMatchObject({
      ok: true,
      unchanged: true,
      next: inStock,
      events: [{ event: "note", note: "повторний скан" }],
    });
  });

  it("повернення проданого, втраченого чи списаного бокса відхиляється", () => {
    for (const status of ["sold", "lost", "retired"] as const) {
      expect(applyBoxAction(state(status), "return"), status).toMatchObject({ ok: false });
    }
  });

  it("продаж: зі складу чи з клієнта → продано, клієнта й замовлення знято", () => {
    expect(applyBoxAction(inStock, "sell", order)).toMatchObject({
      ok: true,
      next: { status: "sold", currentClientId: null },
      events: [{ event: "sold", clientId: "c2", orderId: "o2" }],
    });
    expect(applyBoxAction(atClient, "sell")).toMatchObject({
      ok: true,
      next: { status: "sold" },
      events: [{ event: "sold", clientId: "c1", orderId: "o1" }],
    });
    for (const status of ["sold", "lost", "retired"] as const) {
      expect(applyBoxAction(state(status), "sell", order), status).toMatchObject({ ok: false });
    }
  });

  it("втрата лише з «У клієнта», «знайдено» лише з «Втрачено»", () => {
    expect(applyBoxAction(atClient, "lose")).toMatchObject({
      ok: true,
      next: { status: "lost", currentClientId: null },
      events: [{ event: "lost", clientId: "c1" }],
    });
    expect(applyBoxAction(inStock, "lose")).toMatchObject({ ok: false });
    expect(applyBoxAction(state("lost"), "find")).toMatchObject({
      ok: true,
      next: { status: "in_stock" },
      events: [{ event: "found" }],
    });
    expect(applyBoxAction(inStock, "find")).toMatchObject({ ok: false });
  });

  it("списання зі складу чи втраченого; з інших статусів ні", () => {
    for (const status of ["in_stock", "lost"] as const) {
      expect(applyBoxAction(state(status), "retire"), status).toMatchObject({
        ok: true,
        next: { status: "retired" },
      });
    }
    for (const status of ["at_client", "sold", "retired"] as const) {
      expect(applyBoxAction(state(status), "retire"), status).toMatchObject({ ok: false });
    }
  });

  it("переміщення між локаціями лише для бокса на складі, статус не міняється", () => {
    expect(applyBoxAction(inStock, "transfer")).toMatchObject({
      ok: true,
      next: inStock,
      events: [{ event: "transferred" }],
    });
    expect(applyBoxAction(atClient, "transfer")).toMatchObject({ ok: false });
  });

  it("стани, які ми повертаємо, завжди узгоджені: клієнт лише в «У клієнта»", () => {
    const statuses = ["in_stock", "at_client", "sold", "lost", "retired"] as const;
    const actions = ["issue", "return", "sell", "lose", "find", "retire", "transfer"] as const;
    for (const status of statuses) {
      for (const action of actions) {
        const from: BoxState =
          status === "at_client"
            ? atClient
            : { status, currentClientId: null, currentOrderId: null };
        const r = applyBoxAction(from, action, order);
        if (!r.ok) continue;
        expect(r.next.currentClientId !== null, `${status}+${action}`).toBe(
          r.next.status === "at_client",
        );
        expect(r.events.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("хто що може (ТЗ 2.2, 5.2)", () => {
  const who = (action: Parameters<typeof canDoBoxAction>[1]) =>
    USER_ROLES.filter((role) => canDoBoxAction(role, action));

  it("видача, повернення, «знайдено»: власник, старший локації, виробництво", () => {
    for (const action of ["issue", "return", "find"] as const) {
      expect(who(action), action).toEqual(["owner", "location_lead", "production"]);
    }
  });

  it("продаж: власник і старший локації; втрата, списання, переміщення лише власник", () => {
    expect(who("sell")).toEqual(["owner", "location_lead"]);
    for (const action of ["lose", "retire", "transfer"] as const) {
      expect(who(action), action).toEqual(["owner"]);
    }
  });

  it("водій, менеджер і бухгалтер боксів не сканують", () => {
    for (const role of ["driver", "manager", "accountant"] as const) {
      expect(canDoBoxAction(role, "issue")).toBe(false);
      expect(canDoBoxAction(role, "return")).toBe(false);
    }
  });
});

describe("коди й замовлення", () => {
  it("код K-0001, після 9999 п'ять цифр; номер з коду", () => {
    expect(formatBoxCode("K", 1)).toBe("K-0001");
    expect(formatBoxCode("L", 12345)).toBe("L-12345");
    expect(boxCodeSequence("K-0042", "K")).toBe(42);
    expect(boxCodeSequence("L-0042", "K")).toBeNull();
    expect(boxCodeSequence("K-12", "K")).toBeNull();
  });

  it("з QR беремо код: чистий, з адреси сайту, з пробілами й малими літерами", () => {
    expect(parseBoxCode("K-0001")).toBe("K-0001");
    expect(parseBoxCode("  k-0001 ")).toBe("K-0001");
    expect(parseBoxCode("https://crm.example.com/b/L-0007")).toBe("L-0007");
    expect(parseBoxCode("https://crm.example.com/b/L-0007/?x=1")).toBe("L-0007");
    expect(parseBoxCode("hello")).toBeNull();
    expect(parseBoxCode("K-1")).toBeNull();
    expect(parseBoxCode("")).toBeNull();
  });

  it("до замовлення видають лише у виробництві й запаковане", () => {
    expect(canIssueBoxesToOrder("in_production")).toBe(true);
    expect(canIssueBoxesToOrder("packed")).toBe(true);
    for (const s of ["draft", "confirmed", "shipped", "paid", "closed", "cancelled"]) {
      expect(canIssueBoxesToOrder(s), s).toBe(false);
    }
  });
});
