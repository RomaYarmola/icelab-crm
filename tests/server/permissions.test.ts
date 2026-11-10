import { describe, expect, it } from "vitest";
import { userRole } from "@/db/schema/enums";
import {
  RESOURCES,
  type Resource,
  type UserRole,
  USER_ROLES,
  can,
  canAccessLocation,
  canUseWeb,
  isBotOnly,
  isLocationBound,
  isOwnLocationOnly,
} from "@/server/permissions";

/**
 * Матриця прав з ТЗ (розділ 2.2), переписана з документа окремо від коду.
 * Колонки: власник, менеджер, старший локації, виробництво, бухгалтер, водій.
 * «R» читати («Ч»), «W» записувати («З»), «RW» обидва, «-» немає доступу,
 * «*» лише своя локація («св.»), «~» лише через Telegram-бота.
 */
const TZ_MATRIX: Record<Resource, readonly [string, string, string, string, string, string]> = {
  // Клієнти, адреси (старший локації без цін)
  clients: ["RW", "RW", "R", "-", "R", "-"],
  // Ціни клієнта, історія
  client_prices: ["RW", "RW", "-", "-", "R", "-"],
  // Довідники
  reference_data: ["RW", "R", "R", "R", "R", "-"],
  // Замовлення: створення, правка до «у виробництві»
  orders: ["RW", "RW", "RW*", "-", "R", "-"],
  // Замовлення: суми й ціни
  order_money: ["R", "R", "-", "-", "R", "-"],
  // Екран виробництва
  production_screen: ["R", "R", "RW*", "RW*", "-", "-"],
  // Статус «готово/запаковано»
  order_ready_status: ["W", "-", "W*", "W*", "-", "-"],
  // Готівка по замовленню (водій записує через бота)
  order_cash: ["RW", "R", "RW*", "-", "R", "W~"],
  // Безготівка, виписка, зіставлення
  bank_payments: ["RW", "-", "-", "-", "RW", "-"],
  // Бокси: скан видачі й повернення
  box_scan: ["W", "-", "W*", "W*", "-", "-"],
  // Бокси: списання загубленого
  box_writeoff: ["W", "-", "-", "-", "-", "-"],
  // Бокси: борги, склад
  box_debts_stock: ["R", "R", "R*", "R*", "R", "-"],
  // ТТН: створення, стікери
  shipments: ["W", "W", "W*", "-", "-", "-"],
  // Чернетки з бота: підтвердження
  bot_drafts: ["W", "W", "-", "-", "-", "-"],
  // Аналітика
  analytics: ["R", "R", "-", "-", "R", "-"],
  // Експорт Excel
  excel_export: ["W", "W", "-", "-", "W", "-"],
  // Користувачі, ролі (рядок ТЗ «Користувачі, ролі, журнал змін»: власник Ч/З)
  users: ["RW", "-", "-", "-", "-", "-"],
  // Журнал змін (власник читає, бухгалтер «Ч журнал»; редагувати журнал не можна нікому)
  audit_log: ["R", "-", "-", "-", "R", "-"],
  // Міграція, налаштування інтеграцій
  migration_settings: ["W", "-", "-", "-", "-", "-"],
};

describe("матриця прав з ТЗ", () => {
  it("містить рівно ті самі ролі, що й база", () => {
    expect([...USER_ROLES]).toEqual([...userRole.enumValues]);
    expect(USER_ROLES).toEqual([
      "owner",
      "manager",
      "location_lead",
      "production",
      "accountant",
      "driver",
    ]);
  });

  it("тест описує ті самі рядки, що й код", () => {
    expect(Object.keys(TZ_MATRIX).sort()).toEqual([...RESOURCES].sort());
  });

  for (const resource of RESOURCES) {
    describe(resource, () => {
      USER_ROLES.forEach((role, column) => {
        it(`роль ${role}`, () => {
          const spec = TZ_MATRIX[resource][column]!;
          expect(can(role, resource, "read"), "читання").toBe(spec.includes("R"));
          expect(can(role, resource, "write"), "запис").toBe(spec.includes("W"));
          expect(isOwnLocationOnly(role, resource), "лише своя локація").toBe(spec.includes("*"));
          expect(isBotOnly(role, resource), "лише через бота").toBe(spec.includes("~"));
        });
      });
    });
  }
});

describe("правила поза матрицею", () => {
  it("водій не має входу у веб, усі інші мають", () => {
    for (const role of USER_ROLES) expect(canUseWeb(role)).toBe(role !== "driver");
  });

  it("локація обов'язкова для старшого локації, виробництва й водія", () => {
    const bound = USER_ROLES.filter((role) => isLocationBound(role));
    expect(bound).toEqual(["location_lead", "production", "driver"]);
  });

  it("користувач без локації бачить усі локації, з локацією лише свою", () => {
    expect(canAccessLocation({ locationId: null }, "kyiv")).toBe(true);
    expect(canAccessLocation({ locationId: null }, null)).toBe(true);
    expect(canAccessLocation({ locationId: "kyiv" }, "kyiv")).toBe(true);
    expect(canAccessLocation({ locationId: "kyiv" }, "lviv")).toBe(false);
    // Запис без локації користувачу з локацією не показуємо.
    expect(canAccessLocation({ locationId: "kyiv" }, null)).toBe(false);
  });

  it("ключові правила ТЗ: виробництво без грошей, безнал лише власнику й бухгалтеру", () => {
    const production: UserRole = "production";
    for (const resource of [
      "order_money",
      "order_cash",
      "bank_payments",
      "client_prices",
    ] as const) {
      expect(can(production, resource, "read"), resource).toBe(false);
    }
    const withBank = USER_ROLES.filter((role) => can(role, "bank_payments", "read"));
    expect(withBank).toEqual(["owner", "accountant"]);
  });
});
