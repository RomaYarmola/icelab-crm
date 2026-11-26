import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "@/db/schema";
import { getAnalytics } from "@/server/analytics";
import { listAuditEntries } from "@/server/audit";
import { resolveAppUser } from "@/server/current-user";
import { ForbiddenError, type AppUser } from "@/server/guards";
import { listDebts, listQueue } from "@/server/payment-views";
import { can, roleLabelOf, seesOwnClientsOnly } from "@/server/permissions";
import { updateUserProfile } from "@/server/users";
import { navItemsFor, canOpenPage } from "@/utils/navigation";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("менеджер, який ще й бухгалтер (D243)", () => {
  let t: OrderTestContext;
  let bookkeeper: AppUser;
  const admin = {
    createUser: async () => ({ id: "" }),
    deleteUser: async () => {},
    setPassword: async () => {},
    setBanned: async () => {},
  };

  beforeAll(async () => {
    t = await setupOrderTests();
    await updateUserProfile({ db: t.db, admin }, t.users.owner, t.users.manager.id, {
      isBookkeeper: true,
    });
    bookkeeper = await resolveAppUser(t.db, { sub: t.users.manager.id });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("лишається менеджером і отримує оплати, журнал та всю аналітику", async () => {
    expect(bookkeeper).toMatchObject({ role: "manager", isBookkeeper: true });
    expect(roleLabelOf(bookkeeper)).toBe("Менеджер, бухгалтер");
    expect(can(bookkeeper, "orders", "write")).toBe(true);
    expect(can(bookkeeper, "clients", "write")).toBe(true);
    await expect(listQueue(t.db, bookkeeper)).resolves.toBeDefined();
    await expect(listDebts(t.db, bookkeeper)).resolves.toBeDefined();
    await expect(listAuditEntries(t.db, bookkeeper, {})).resolves.toBeDefined();
    expect(seesOwnClientsOnly(bookkeeper)).toBe(false);
    expect(canOpenPage(bookkeeper, "payments")).toBe(true);
    expect(canOpenPage(bookkeeper, "audit")).toBe(true);
    expect(navItemsFor(bookkeeper, "side").map((item) => item.id)).toContain("payments");
    const query = { from: "2026-11", to: "2026-11" };
    await expect(getAnalytics(t.db, bookkeeper, query)).resolves.toMatchObject({ ownOnly: false });
  });

  it("не отримує прав власника: фінрезультат, користувачі, сторно", () => {
    for (const [resource, kind] of [
      ["finance", "read"],
      ["users", "read"],
      ["cash_reversal", "write"],
      ["default_prices", "write"],
    ] as const) {
      expect(can(bookkeeper, resource, kind), resource).toBe(false);
    }
  });

  it("звичайний менеджер без позначки цього не має", async () => {
    const plain = { ...bookkeeper, isBookkeeper: false };
    await expect(listQueue(t.db, plain)).rejects.toBeInstanceOf(ForbiddenError);
    expect(canOpenPage(plain, "audit")).toBe(false);
    expect(seesOwnClientsOnly(plain)).toBe(true);
  });

  it("позначка знімається, коли роль більше не менеджер", async () => {
    await updateUserProfile({ db: t.db, admin }, t.users.owner, t.users.manager.id, {
      role: "accountant",
    });
    const [row] = await t.db.select().from(profiles).where(eq(profiles.id, t.users.manager.id));
    expect(row).toMatchObject({ role: "accountant", isBookkeeper: false });
  });
});
