import { describe, expect, it } from "vitest";
import { NAV_ITEMS, type NavItemId } from "@/constants/navigation";
import { USER_ROLES, type UserRole } from "@/server/permissions";
import {
  accountNavItemsFor,
  canOpenPage,
  extraNavItemsFor,
  homePathFor,
  isActivePath,
  navItemsFor,
  sideExtraNavItemsFor,
} from "@/utils/navigation";

const ids = (role: UserRole, placement: "bar" | "side") =>
  navItemsFor(role, placement).map((item) => item.id);

describe("меню за ролями (ТЗ §6.1)", () => {
  const expected: Record<
    Exclude<UserRole, "driver">,
    { bar: NavItemId[]; side: NavItemId[]; home: string }
  > = {
    owner: {
      bar: ["orders", "production", "payments", "cash", "more"],
      side: ["orders", "production", "payments", "cash", "shipments", "clients", "boxes"],
      home: "/orders",
    },
    manager: {
      bar: ["orders", "production", "cash", "shipments", "more"],
      side: ["orders", "production", "cash", "shipments", "clients", "boxes"],
      home: "/orders",
    },
    location_lead: {
      bar: ["orders", "production", "cash", "shipments", "more"],
      side: ["orders", "production", "cash", "shipments", "clients", "boxes"],
      home: "/production",
    },
    production: {
      bar: ["production", "boxes", "more"],
      side: ["production", "boxes"],
      home: "/production",
    },
    accountant: {
      bar: ["orders", "payments", "cash", "clients", "more"],
      side: ["orders", "payments", "cash", "clients", "boxes"],
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
    expect(isActivePath("/profile", "/profile")).toBe(true);
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
    // Порядок у «Ще» той самий, що й у бічній панелі комп'ютера.
    expect(extraNavItemsFor("owner").map((item) => item.id)).toEqual([
      "shipments",
      "clients",
      "boxes",
    ]);
    for (const role of ["manager", "location_lead", "accountant"] as const) {
      expect(
        extraNavItemsFor(role).map((item) => item.id),
        role,
      ).toEqual(role === "accountant" ? ["boxes"] : ["clients", "boxes"]);
    }
    expect(extraNavItemsFor("production")).toEqual([]);
  });

  it("нижня панель це перші чотири розділи бічної в тому ж порядку", () => {
    for (const role of USER_ROLES) {
      const side = ids(role, "side");
      const bar = ids(role, "bar").filter((id) => id !== "more");
      expect(bar, role).toEqual(side.slice(0, 4));
    }
  });
});

describe("заголовки сторінок у шапці", () => {
  it("сторінка «Ще» в шапці називається «Профіль», решта пунктів як у меню", () => {
    expect(NAV_ITEMS.more.label).toBe("Ще");
    expect(NAV_ITEMS.more.title).toBe("Профіль");
    for (const item of Object.values(NAV_ITEMS)) {
      // Власний заголовок у шапці мають лише «Ще» (Профіль) і «Накладні» (ТТН на день).
      if (item.id !== "more" && item.id !== "shipments") {
        expect(item.title, item.id).toBeUndefined();
      }
    }
  });
});

describe("екрани всередині «Ще» («Готівка», «Прайс», «Журнал змін», «Експорт усього», «Користувачі»)", () => {
  const ids = (role: UserRole) => accountNavItemsFor(role).map((item) => item.id);

  it("власник бачить «Прайс», «Журнал змін», «Експорт даних» і «Користувачі», бухгалтер «Прайс» і «Журнал змін», менеджер «Прайс»", () => {
    expect(ids("owner")).toEqual(["prices", "audit", "export", "users", "np"]);
    expect(ids("manager")).toEqual(["prices"]);
    expect(ids("accountant")).toEqual(["prices", "audit"]);
  });

  it("старший локації, виробництво й водій цих екранів не мають", () => {
    for (const role of ["location_lead", "production", "driver"] as const) {
      expect(ids(role), role).toEqual([]);
    }
  });

  it("«Готівка» самостійний розділ: у бічній панелі перед «Клієнтами»", () => {
    for (const role of USER_ROLES) {
      const side = navItemsFor(role, "side").map((item) => item.id);
      expect(canOpenPage(role, "cash"), role).toBe(side.includes("cash"));
      if (side.includes("cash")) expect(side.indexOf("cash")).toBeLessThan(side.indexOf("clients"));
    }
    expect(NAV_ITEMS.cash.href).toBe("/cash");
    expect(isActivePath("/cash", NAV_ITEMS.more.href)).toBe(false);
  });

  it("сторінка прайсу відкривається тим, кому вона в меню, і лише їм", () => {
    for (const role of USER_ROLES) {
      expect(canOpenPage(role, "prices"), role).toBe(ids(role).includes("prices"));
    }
  });

  it("«Прайс» не розділ нижньої панелі й не бічної: він лише в меню «Ще»", () => {
    for (const role of USER_ROLES) {
      expect(navItemsFor(role, "bar").map((item) => item.id)).not.toContain("prices");
      expect(navItemsFor(role, "side").map((item) => item.id)).not.toContain("prices");
    }
    expect(NAV_ITEMS.prices.href).toBe("/prices");
  });

  it("адреса прайсу вкладена в «Ще»: підсвічується «Ще», а заголовок бере власну назву", () => {
    expect(isActivePath("/prices", NAV_ITEMS.more.href)).toBe(false);
    expect(isActivePath("/prices", NAV_ITEMS.prices.href)).toBe(true);
    expect(NAV_ITEMS.prices.title).toBeUndefined();
  });
});

describe("журнал змін у меню (B8, D89)", () => {
  it("відкривається лише власнику й бухгалтеру, у меню «Ще»", () => {
    for (const role of USER_ROLES) {
      const allowed = role === "owner" || role === "accountant";
      expect(canOpenPage(role, "audit"), role).toBe(allowed);
      expect(
        navItemsFor(role, "bar").map((item) => item.id),
        role,
      ).not.toContain("audit");
      expect(
        navItemsFor(role, "side").map((item) => item.id),
        role,
      ).not.toContain("audit");
    }
    expect(NAV_ITEMS.audit.href).toBe("/audit");
    expect(isActivePath("/audit", NAV_ITEMS.more.href)).toBe(false);
  });
});

describe("«Експорт усього» у меню (B8, D94)", () => {
  it("відкривається лише власнику, у меню «Ще»", () => {
    for (const role of USER_ROLES) {
      expect(canOpenPage(role, "export"), role).toBe(role === "owner");
      expect(
        navItemsFor(role, "bar").map((item) => item.id),
        role,
      ).not.toContain("export");
      expect(
        navItemsFor(role, "side").map((item) => item.id),
        role,
      ).not.toContain("export");
    }
    expect(NAV_ITEMS.export.href).toBe("/export");
    expect(isActivePath("/export", NAV_ITEMS.more.href)).toBe(false);
  });
});

describe("екрани в бічній панелі комп'ютера після розділів", () => {
  const ids = (role: UserRole) => sideExtraNavItemsFor(role).map((item) => item.id);

  it("власник: «Прайс», «Журнал змін», «Експорт даних», «Користувачі»", () => {
    expect(ids("owner")).toEqual(["prices", "audit", "export", "users", "np"]);
  });

  it("бухгалтер лише «Журнал змін», решта ролей нічого", () => {
    expect(ids("accountant")).toEqual(["audit"]);
    for (const role of ["manager", "location_lead", "production", "driver"] as const) {
      expect(ids(role), role).toEqual([]);
    }
  });

  it("на телефоні вони лишаються в меню «Ще» власника", () => {
    expect(accountNavItemsFor("owner").map((item) => item.id)).toEqual(
      expect.arrayContaining(["prices", "audit", "export", "users", "np"]),
    );
  });

  it("екран називається «Експорт даних»", () => {
    expect(NAV_ITEMS.export.label).toBe("Експорт даних");
  });
});

describe("«Нова Пошта» у меню (B10)", () => {
  it("відкривається лише власнику", () => {
    for (const role of USER_ROLES) {
      expect(canOpenPage(role, "np"), role).toBe(role === "owner");
    }
    expect(NAV_ITEMS.np.href).toBe("/np");
  });
});

describe("«Накладні» (ТТН на день) у меню (B10)", () => {
  it("відкривається власнику, менеджеру й старшому локації, стоїть після «Готівки» перед «Клієнтами»", () => {
    for (const role of USER_ROLES) {
      const allowed = role === "owner" || role === "manager" || role === "location_lead";
      expect(canOpenPage(role, "shipments"), role).toBe(allowed);
      const side = navItemsFor(role, "side").map((item) => item.id);
      expect(side.includes("shipments"), role).toBe(allowed);
      if (allowed) {
        expect(side.indexOf("shipments")).toBeGreaterThan(side.indexOf("cash"));
        expect(side.indexOf("shipments")).toBeLessThan(side.indexOf("clients"));
      }
    }
    expect(NAV_ITEMS.shipments).toMatchObject({ href: "/shipments", title: "ТТН на день" });
  });
});
