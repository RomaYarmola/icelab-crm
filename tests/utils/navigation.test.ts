import { describe, expect, it } from "vitest";
import { NAV_ITEMS, type NavItemId } from "@/constants/navigation";
import { USER_ROLES, type UserRole } from "@/server/permissions";
import {
  canOpenPage,
  extraNavItemsFor,
  homePathFor,
  isActivePath,
  navItemsFor,
} from "@/utils/navigation";

const ids = (role: UserRole, placement: "bar" | "side") =>
  navItemsFor(role, placement).map((item) => item.id);

describe("меню за ролями (ТЗ §6.1)", () => {
  const expected: Record<
    Exclude<UserRole, "driver">,
    { bar: NavItemId[]; side: NavItemId[]; home: string }
  > = {
    owner: {
      bar: ["orders", "clients", "production", "boxes", "more"],
      side: ["orders", "clients", "production", "payments", "boxes"],
      home: "/orders",
    },
    manager: {
      bar: ["orders", "clients", "production", "boxes", "more"],
      side: ["orders", "clients", "production", "boxes"],
      home: "/orders",
    },
    location_lead: {
      bar: ["orders", "clients", "production", "boxes", "more"],
      side: ["orders", "clients", "production", "boxes"],
      home: "/production",
    },
    production: {
      bar: ["production", "boxes", "more"],
      side: ["production", "boxes"],
      home: "/production",
    },
    accountant: {
      bar: ["orders", "clients", "payments", "boxes", "more"],
      side: ["orders", "clients", "payments", "boxes"],
      home: "/payments",
    },
  };

  for (const [role, want] of Object.entries(expected) as [
    Exclude<UserRole, "driver">,
    (typeof expected)["owner"],
  ][]) {
    it(`${role}: нижня панель, бічна панель і сторінка після входу`, () => {
      expect(ids(role, "bar")).toEqual(want.bar);
      expect(ids(role, "side")).toEqual(want.side);
      expect(homePathFor(role)).toBe(want.home);
    });
  }

  it("водій у веб не входить: меню порожнє, сторінок немає", () => {
    expect(navItemsFor("driver", "bar")).toEqual([]);
    expect(navItemsFor("driver", "side")).toEqual([]);
    expect(homePathFor("driver")).toBe("/login");
    for (const id of ["orders", "production", "more"] as const) {
      expect(canOpenPage("driver", id)).toBe(false);
    }
  });

  it("сторінка після входу завжди відкривається своїй ролі (без кола перенаправлень)", () => {
    for (const role of USER_ROLES) {
      if (role === "driver") continue;
      const home = homePathFor(role);
      const item = navItemsFor(role, "side").find((entry) => entry.href === home);
      expect(item, `${role}: початкова сторінка ${home} є в меню`).toBeDefined();
      expect(canOpenPage(role, item!.id)).toBe(true);
    }
  });

  it("у нижній панелі не більше п'яти пунктів, «Ще» завжди останній", () => {
    for (const role of USER_ROLES) {
      const bar = ids(role, "bar");
      expect(bar.length).toBeLessThanOrEqual(5);
      if (role !== "driver") expect(bar.at(-1)).toBe("more");
    }
  });

  it("кожен пункт меню відкривається, а закритий розділ не відкривається", () => {
    for (const role of USER_ROLES) {
      for (const placement of ["bar", "side"] as const) {
        for (const item of navItemsFor(role, placement)) {
          expect(canOpenPage(role, item.id)).toBe(true);
        }
      }
    }
    expect(canOpenPage("production", "orders")).toBe(false);
    expect(canOpenPage("production", "clients")).toBe(false);
    expect(canOpenPage("production", "payments")).toBe(false);
    expect(canOpenPage("manager", "payments")).toBe(false);
    expect(canOpenPage("accountant", "production")).toBe(false);
    expect(canOpenPage("owner", "payments")).toBe(true);
  });

  it("активний пункт: сама адреса і вкладені сторінки, але не схожий префікс", () => {
    expect(isActivePath("/orders", "/orders")).toBe(true);
    expect(isActivePath("/orders/3472", "/orders")).toBe(true);
    expect(isActivePath("/more/users", "/more")).toBe(true);
    expect(isActivePath("/orders-archive", "/orders")).toBe(false);
    expect(isActivePath("/clients", "/orders")).toBe(false);
    expect(isActivePath("/", "/orders")).toBe(false);
  });

  it("бічна панель комп'ютера без «Ще»: профіль відкривається з блока користувача", () => {
    for (const role of USER_ROLES) {
      expect(ids(role, "side")).not.toContain("more");
    }
  });

  it("розділи, яких немає в нижній панелі, потрапляють у меню «Ще»", () => {
    expect(extraNavItemsFor("owner").map((item) => item.id)).toEqual(["payments"]);
    for (const role of ["manager", "location_lead", "production", "accountant"] as const) {
      expect(extraNavItemsFor(role)).toEqual([]);
    }
    expect(extraNavItemsFor("driver")).toEqual([]);
  });

  it("оплати власника переходять у «Ще» на телефоні, але є на комп'ютері", () => {
    expect(ids("owner", "bar")).not.toContain("payments");
    expect(ids("owner", "side")).toContain("payments");
  });
});

describe("заголовки сторінок у шапці", () => {
  it("сторінка «Ще» в шапці називається «Профіль», решта пунктів як у меню", () => {
    expect(NAV_ITEMS.more.label).toBe("Ще");
    expect(NAV_ITEMS.more.title).toBe("Профіль");
    for (const item of Object.values(NAV_ITEMS)) {
      if (item.id !== "more") expect(item.title, item.id).toBeUndefined();
    }
  });
});
