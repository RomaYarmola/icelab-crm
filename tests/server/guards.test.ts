import { describe, expect, it } from "vitest";
import {
  type AppUser,
  ForbiddenError,
  locationScope,
  requireLocation,
  requirePermission,
  requireRole,
} from "@/server/guards";
import type { UserRole } from "@/server/permissions";

const KYIV = "11111111-1111-4111-8111-111111111111";
const LVIV = "22222222-2222-4222-8222-222222222222";

function user(role: UserRole, locationId: string | null = null): AppUser {
  return {
    id: crypto.randomUUID(),
    email: null,
    fullName: "Тест",
    role,
    locationId,
    locationName: null,
  };
}

describe("requireRole", () => {
  it("пропускає перелічені ролі й відмовляє іншим", () => {
    expect(() => requireRole(user("owner"), "owner")).not.toThrow();
    expect(() => requireRole(user("manager"), "owner", "manager")).not.toThrow();
    expect(() => requireRole(user("production", KYIV), "owner", "manager")).toThrow(ForbiddenError);
  });
});

describe("requirePermission", () => {
  it("відмовляє, якщо матриця не дає права", () => {
    expect(() => requirePermission(user("production", KYIV), "order_money", "read")).toThrow(
      ForbiddenError,
    );
    expect(() => requirePermission(user("manager"), "users", "write")).toThrow(ForbiddenError);
    expect(() => requirePermission(user("owner"), "users", "write")).not.toThrow();
  });

  it("для запису перевіряє локацію: свою можна, чужу ні", () => {
    const lead = user("location_lead", KYIV);
    expect(() =>
      requirePermission(lead, "orders", "write", { recordLocationId: KYIV }),
    ).not.toThrow();
    expect(() => requirePermission(lead, "orders", "write", { recordLocationId: LVIV })).toThrow(
      ForbiddenError,
    );
    expect(() => requirePermission(lead, "orders", "write", { recordLocationId: null })).toThrow(
      ForbiddenError,
    );
  });

  it("роль без локації («усі локації») проходить для будь-якого запису", () => {
    expect(() =>
      requirePermission(user("manager"), "orders", "write", { recordLocationId: LVIV }),
    ).not.toThrow();
  });

  it("для ролі з правом лише своєї локації вимагає вказати область дії", () => {
    const lead = user("location_lead", KYIV);
    expect(() => requirePermission(lead, "orders", "read")).toThrowError(/recordLocationId/);
    expect(() => requirePermission(lead, "orders", "read", { anyLocation: true })).not.toThrow();
    // Для ролей без обмеження локацією область дії не потрібна.
    expect(() => requirePermission(user("owner"), "orders", "read")).not.toThrow();
  });

  it("право на розділ не обходить заборону матриці навіть з anyLocation", () => {
    const production = user("production", KYIV);
    expect(() => requirePermission(production, "orders", "read", { anyLocation: true })).toThrow(
      ForbiddenError,
    );
  });
});

describe("requireLocation і locationScope", () => {
  it("requireLocation відмовляє для чужої локації", () => {
    expect(() => requireLocation(user("production", KYIV), KYIV)).not.toThrow();
    expect(() => requireLocation(user("production", KYIV), LVIV)).toThrow(ForbiddenError);
    expect(() => requireLocation(user("accountant"), LVIV)).not.toThrow();
  });

  it("locationScope повертає локацію для фільтрації списків або null для «усіх»", () => {
    expect(locationScope(user("production", KYIV))).toBe(KYIV);
    expect(locationScope(user("manager"))).toBeNull();
  });
});
