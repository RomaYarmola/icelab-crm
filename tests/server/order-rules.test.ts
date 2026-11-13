import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@/constants/constants";
import {
  allowedTransitions,
  canDeleteDraft,
  checkTransition,
  DEFAULT_MARKUP_SETTINGS,
  editPolicy,
  isLikelyDuplicate,
  isReadyToClose,
  nextStatus,
  previousStatus,
  STATUS_FLOW,
  suggestMarkupPercent,
  transitionOptions,
} from "@/server/order-rules";
import { USER_ROLES, type UserRole } from "@/server/permissions";

const ALL_STATUSES: OrderStatus[] = [...STATUS_FLOW, "cancelled"];
const WEB_ROLES = USER_ROLES.filter((role) => role !== "driver");

const forwardWho: Record<string, UserRole[]> = {
  confirmed: ["owner", "manager"],
  in_production: ["owner", "location_lead", "production"],
  packed: ["owner", "location_lead", "production"],
  shipped: ["owner", "manager", "location_lead"],
  paid: ["owner"],
};

describe("ланцюжок статусів (D51)", () => {
  it("порядок і сусіди", () => {
    expect(STATUS_FLOW).toEqual([
      "draft",
      "confirmed",
      "in_production",
      "packed",
      "shipped",
      "paid",
      "closed",
    ]);
    expect(nextStatus("draft")).toBe("confirmed");
    expect(nextStatus("closed")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
    expect(previousStatus("confirmed")).toBe("draft");
    expect(previousStatus("draft")).toBeNull();
    expect(previousStatus("cancelled")).toBeNull();
  });
});

describe("кроки вперед: хто що може", () => {
  for (const [to, roles] of Object.entries(forwardWho)) {
    const from = previousStatus(to as OrderStatus)!;
    it(`${from} → ${to}: ${roles.join(", ")}`, () => {
      for (const role of USER_ROLES) {
        const check = checkTransition(from, to as OrderStatus, role);
        expect(check.ok, `${role}`).toBe(roles.includes(role));
        if (check.ok) expect(check.kind).toBe("forward");
      }
    });
  }

  it("«Оплачено» вручну потребує примітки, решта кроків вперед ні", () => {
    for (const [to, roles] of Object.entries(forwardWho)) {
      const check = checkTransition(
        previousStatus(to as OrderStatus)!,
        to as OrderStatus,
        roles[0]!,
      );
      expect(check.ok && check.needsNote, to).toBe(to === "paid");
    }
  });

  it("«Закрито» ставить лише система, жодна роль", () => {
    for (const role of USER_ROLES) {
      expect(checkTransition("paid", "closed", role).ok, role).toBe(false);
    }
    expect(checkTransition("paid", "closed", "system")).toEqual({
      ok: true,
      kind: "forward",
      needsNote: false,
    });
  });

  it("пропускати статуси не можна, навіть власнику", () => {
    expect(checkTransition("draft", "in_production", "owner").ok).toBe(false);
    expect(checkTransition("confirmed", "packed", "owner").ok).toBe(false);
    expect(checkTransition("draft", "closed", "system").ok).toBe(false);
  });

  it("той самий статус і невідомі пари відхиляються", () => {
    for (const status of ALL_STATUSES)
      expect(checkTransition(status, status, "owner").ok).toBe(false);
    expect(checkTransition("cancelled", "draft", "owner").ok).toBe(false);
    expect(checkTransition("closed", "cancelled", "owner").ok).toBe(false);
  });
});

describe("скасування", () => {
  it("до «Відправлено» власник і менеджер, причина обов'язкова", () => {
    for (const from of ["draft", "confirmed", "in_production", "packed"] as const) {
      for (const role of USER_ROLES) {
        const check = checkTransition(from, "cancelled", role);
        expect(check.ok, `${from} ${role}`).toBe(role === "owner" || role === "manager");
        if (check.ok) expect(check).toEqual({ ok: true, kind: "cancel", needsNote: true });
      }
    }
  });

  it("після відправлення лише власник", () => {
    for (const from of ["shipped", "paid"] as const) {
      for (const role of USER_ROLES) {
        expect(checkTransition(from, "cancelled", role).ok, `${from} ${role}`).toBe(
          role === "owner",
        );
      }
    }
  });

  it("закрите і скасоване вже не скасувати", () => {
    for (const role of USER_ROLES) {
      expect(checkTransition("closed", "cancelled", role).ok).toBe(false);
      expect(checkTransition("cancelled", "cancelled", role).ok).toBe(false);
    }
  });
});

describe("крок назад", () => {
  it("лише власник, на один статус, з приміткою (крім «Повернути в роботу», D73)", () => {
    for (const from of [
      "confirmed",
      "in_production",
      "packed",
      "shipped",
      "paid",
      "closed",
    ] as const) {
      const to = previousStatus(from)!;
      for (const role of USER_ROLES) {
        const check = checkTransition(from, to, role);
        const allowed = role === "owner" || (from === "packed" && role === "location_lead");
        expect(check.ok, `${from} ${role}`).toBe(allowed);
        if (check.ok) expect(check).toEqual({ ok: true, kind: "back", needsNote: true });
      }
    }
  });

  it("«Повернути в роботу» з «Запаковано»: власник і старший локації, виробництво ні (D73)", () => {
    for (const role of USER_ROLES) {
      const check = checkTransition("packed", "in_production", role);
      expect(check.ok, role).toBe(role === "owner" || role === "location_lead");
      if (!check.ok) expect(check.reason).toContain("власник або старший локації");
    }
    expect(
      allowedTransitions("packed", "location_lead").map((transition) => transition.to),
    ).toEqual(["shipped", "in_production"]);
    // Інші кроки назад старшому локації недоступні.
    expect(checkTransition("in_production", "confirmed", "location_lead").ok).toBe(false);
    expect(checkTransition("shipped", "packed", "location_lead").ok).toBe(false);
  });

  it("з чернетки і зі скасованого назад нікуди", () => {
    expect(checkTransition("draft", "cancelled", "owner").ok).toBe(true);
    expect(allowedTransitions("cancelled", "owner")).toEqual([]);
    expect(allowedTransitions("closed", "owner")).toEqual([
      { from: "closed", to: "paid", kind: "back" },
    ]);
  });
});

describe("кнопки переходів на картці", () => {
  it("менеджер у чернетці: підтвердити або скасувати", () => {
    expect(allowedTransitions("draft", "manager").map((t) => t.to)).toEqual([
      "confirmed",
      "cancelled",
    ]);
  });

  it("власник у виробництві: далі, назад чи скасувати", () => {
    expect(allowedTransitions("in_production", "owner").map((t) => t.to)).toEqual([
      "packed",
      "confirmed",
      "cancelled",
    ]);
  });

  it("виробництво бачить лише свої кроки", () => {
    expect(allowedTransitions("confirmed", "production").map((t) => t.to)).toEqual([
      "in_production",
    ]);
    expect(allowedTransitions("in_production", "production").map((t) => t.to)).toEqual(["packed"]);
    expect(allowedTransitions("draft", "production")).toEqual([]);
    expect(allowedTransitions("packed", "accountant")).toEqual([]);
  });

  it("кожен перехід із кнопок справді дозволений правилами", () => {
    for (const from of ALL_STATUSES) {
      for (const role of WEB_ROLES) {
        for (const transition of allowedTransitions(from, role)) {
          expect(checkTransition(transition.from, transition.to, role).ok).toBe(true);
        }
      }
    }
  });
});

describe("що можна змінювати (D58)", () => {
  it("власник і менеджер вільно міняють чернетку й підтверджене", () => {
    for (const status of ["draft", "confirmed"] as const) {
      for (const role of ["owner", "manager"] as const) {
        expect(editPolicy(status, role).core, `${status} ${role}`).toBe("free");
      }
    }
  });

  it("у виробництві й запакованому основні поля лише власник із приміткою", () => {
    for (const status of ["in_production", "packed"] as const) {
      expect(editPolicy(status, "owner").core).toBe("owner_note");
      expect(editPolicy(status, "manager").core).toBe("none");
    }
  });

  it("після відправлення, у закритих і скасованих основне не міняється ніким", () => {
    for (const status of ["shipped", "paid", "closed", "cancelled"] as const) {
      for (const role of USER_ROLES)
        expect(editPolicy(status, role).core, `${status} ${role}`).toBe("none");
    }
  });

  it("ціна: у чернетці власник і менеджер, після підтвердження лише власник (D52)", () => {
    expect(editPolicy("draft", "manager").price).toBe("free");
    expect(editPolicy("draft", "owner").price).toBe("free");
    expect(editPolicy("confirmed", "manager").price).toBe("none");
    for (const status of ["confirmed", "in_production", "packed", "shipped", "paid"] as const) {
      expect(editPolicy(status, "owner").price, status).toBe("override");
    }
    for (const status of ["closed", "cancelled"] as const)
      expect(editPolicy(status, "owner").price).toBe("none");
    for (const role of ["location_lead", "production", "accountant", "driver"] as const) {
      for (const status of ALL_STATUSES)
        expect(editPolicy(status, role).price, `${status} ${role}`).toBe("none");
    }
  });

  it("старший локації змінює лише «виготовити» і коментар", () => {
    for (const status of ["confirmed", "in_production", "packed"] as const) {
      expect(editPolicy(status, "location_lead")).toEqual({
        core: "none",
        price: "none",
        produce: true,
        comment: true,
        internalComment: false,
      });
    }
    expect(editPolicy("draft", "location_lead").produce).toBe(false);
    expect(editPolicy("shipped", "location_lead").produce).toBe(false);
  });

  it("виробництво, бухгалтер і водій нічого не міняють", () => {
    for (const role of ["production", "accountant", "driver"] as const) {
      for (const status of ALL_STATUSES) {
        expect(editPolicy(status, role), `${status} ${role}`).toEqual({
          core: "none",
          price: "none",
          produce: false,
          comment: false,
          internalComment: false,
        });
      }
    }
  });

  it("видалити можна лише чернетку, власник і менеджер", () => {
    for (const status of ALL_STATUSES) {
      for (const role of USER_ROLES) {
        expect(canDeleteDraft(status, role), `${status} ${role}`).toBe(
          status === "draft" && (role === "owner" || role === "manager"),
        );
      }
    }
  });
});

describe("надбавка (D53)", () => {
  const base = { deliveryMethod: "pickup", applicationCode: null, clientOverridePercent: null };

  it("без Нової Пошти й особливого застосування 0%", () => {
    expect(suggestMarkupPercent(base)).toBe(0);
    expect(suggestMarkupPercent({ ...base, applicationCode: "bar" })).toBe(0);
  });

  it("Нова Пошта 10%, «Важкий дим» і «Дитячі свята» 10%", () => {
    expect(suggestMarkupPercent({ ...base, deliveryMethod: "np" })).toBe(10);
    expect(suggestMarkupPercent({ ...base, applicationCode: "heavy_smoke" })).toBe(10);
    expect(suggestMarkupPercent({ ...base, applicationCode: "kids_parties" })).toBe(10);
  });

  it("значення беруться з налаштувань (наприклад, 15% для подій)", () => {
    const settings = { npPercent: 10, eventPercent: 15 };
    expect(suggestMarkupPercent({ ...base, applicationCode: "heavy_smoke", settings })).toBe(15);
    expect(
      suggestMarkupPercent({
        ...base,
        deliveryMethod: "np",
        applicationCode: "heavy_smoke",
        settings,
      }),
    ).toBe(15);
    expect(DEFAULT_MARKUP_SETTINGS).toEqual({ npPercent: 10, eventPercent: 10 });
  });

  it("окрема надбавка клієнта сильніша за загальну, навіть нуль", () => {
    expect(suggestMarkupPercent({ ...base, deliveryMethod: "np", clientOverridePercent: 5 })).toBe(
      5,
    );
    expect(suggestMarkupPercent({ ...base, deliveryMethod: "np", clientOverridePercent: 0 })).toBe(
      0,
    );
  });
});

describe("закриття і дублі", () => {
  it("закривається лише оплачене замовлення без боргу по боксах", () => {
    for (const status of ALL_STATUSES) {
      expect(isReadyToClose({ status }), status).toBe(status === "paid");
    }
    expect(isReadyToClose({ status: "paid" }, 2)).toBe(false);
  });

  const order = {
    id: "a",
    clientId: "c1",
    orderDate: "2026-11-13",
    iceTypeId: "ice16",
    status: "draft" as const,
  };

  it("той самий клієнт, дата й тип льоду це схоже замовлення", () => {
    expect(isLikelyDuplicate(order, { ...order, id: "b" })).toBe(true);
    expect(isLikelyDuplicate(order, { ...order, id: "b", status: "paid" })).toBe(true);
  });

  it("інша дата, клієнт чи тип льоду не збігаються", () => {
    expect(isLikelyDuplicate(order, { ...order, id: "b", orderDate: "2026-11-14" })).toBe(false);
    expect(isLikelyDuplicate(order, { ...order, id: "b", clientId: "c2" })).toBe(false);
    expect(isLikelyDuplicate(order, { ...order, id: "b", iceTypeId: "ice3" })).toBe(false);
    expect(isLikelyDuplicate(order, { ...order, id: "b", iceTypeId: null })).toBe(false);
  });

  it("скасоване, видалене й саме замовлення дублем не вважаються", () => {
    expect(isLikelyDuplicate(order, { ...order, id: "b", status: "cancelled" })).toBe(false);
    expect(isLikelyDuplicate(order, { ...order, id: "b", deleted: true })).toBe(false);
    expect(isLikelyDuplicate(order, order)).toBe(false);
  });
});

describe("кнопки переходів із приміткою", () => {
  it("менеджер у чернетці: підтвердити без примітки, скасувати з причиною", () => {
    expect(transitionOptions("draft", "manager")).toEqual([
      { to: "confirmed", kind: "forward", needsNote: false },
      { to: "cancelled", kind: "cancel", needsNote: true },
    ]);
  });

  it("власник у відправленому: «Оплачено» з приміткою, назад і скасування теж", () => {
    expect(transitionOptions("shipped", "owner")).toEqual([
      { to: "paid", kind: "forward", needsNote: true },
      { to: "packed", kind: "back", needsNote: true },
      { to: "cancelled", kind: "cancel", needsNote: true },
    ]);
  });

  it("бухгалтер і закрите замовлення: кнопок немає", () => {
    expect(transitionOptions("confirmed", "accountant")).toEqual([]);
    expect(transitionOptions("cancelled", "owner")).toEqual([]);
  });
});
