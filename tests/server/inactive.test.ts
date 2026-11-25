import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clients, clientStatuses, orders, settings } from "@/db/schema";
import { createClient, listClients, updateClient } from "@/server/clients";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import {
  findInactiveClients,
  INACTIVE_DAYS_KEY,
  listInactiveClients,
  loadInactiveDays,
  setClientOneTime,
  setInactiveDays,
} from "@/server/inactive";
import { daysBetween, inactiveThreshold, rhythmThreshold } from "@/server/inactive-rules";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("поріг «давно не замовляли» (D207)", () => {
  it("дні між датами", () => {
    expect(daysBetween("2026-11-01", "2026-11-25")).toBe(24);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
  it("ритм: 2 × медіана проміжків за останні 6 днів замовлень; менше трьох днів ритму немає", () => {
    expect(rhythmThreshold(["2026-01-01", "2026-01-08"])).toBeNull();
    expect(rhythmThreshold(["2026-01-01", "2026-01-31", "2026-03-02"])).toBe(60);
    // кілька замовлень одного дня це один день
    expect(rhythmThreshold(["2026-01-01", "2026-01-01", "2026-01-01", "2026-01-08"])).toBeNull();
    // старіші за останні шість не рахуються
    const weekly = [
      "2026-01-01",
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
      "2026-07-06",
    ];
    expect(rhythmThreshold(weekly)).toBe(14);
    // парна кількість проміжків: середнє двох середніх
    expect(rhythmThreshold(["2026-01-01", "2026-01-11", "2026-01-31"])).toBe(30);
  });
  it("заданий у картці перемагає; ритм лише збільшує загальний; інакше загальний", () => {
    const weekly = ["2026-06-01", "2026-06-08", "2026-06-15"];
    const monthly = ["2026-01-01", "2026-02-15", "2026-04-01"];
    expect(inactiveThreshold(7, monthly)).toEqual({ days: 7, source: "client" });
    expect(inactiveThreshold(null, weekly)).toEqual({ days: 30, source: "default" });
    expect(inactiveThreshold(null, monthly)).toEqual({ days: 90, source: "rhythm" });
    expect(inactiveThreshold(null, [], 45)).toEqual({ days: 45, source: "default" });
  });
});

describe("список «Давно не замовляли» і разові клієнти (B14, D208)", () => {
  let t: OrderTestContext;
  const now = new Date("2026-11-25T10:00:00Z");

  beforeAll(async () => {
    t = await setupOrderTests();
    const [active] = await t.db
      .select()
      .from(clientStatuses)
      .where(eq(clientStatuses.code, "active"));
    await t.db.update(clients).set({ statusId: active!.id }).where(eq(clients.id, t.client.id));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.update(orders).set({ deletedAt: new Date() });
    await t.db.delete(settings).where(eq(settings.key, INACTIVE_DAYS_KEY));
    await t.db
      .update(clients)
      .set({ isOneTime: false, inactiveDaysThreshold: null, managerId: t.users.manager.id })
      .where(eq(clients.id, t.client.id));
  });

  const order = async (date: string, clientId = t.client.id, confirm = true) => {
    const { id } = await t.create({ orderDate: date, clientId }, t.users.owner);
    if (confirm) await transitionOrder(t.db, t.users.owner, id, "confirmed");
    return id;
  };
  const ids = async () => (await findInactiveClients(t.db, { now })).map((c) => c.clientId);

  it("давнє замовлення потрапляє в список; рівно поріг ще ні; чернетки не рахуються", async () => {
    await order("2026-10-26"); // 30 днів
    expect(await ids()).toEqual([]);
    await t.db.update(orders).set({ deletedAt: new Date() });
    await order("2026-10-01");
    await order("2026-11-20", t.client.id, false); // чернетка
    const list = await findInactiveClients(t.db, { now });
    expect(list[0]).toMatchObject({ clientId: t.client.id, days: 55, lastOrderDate: "2026-10-01" });
    expect(list[0]!.threshold).toEqual({ days: 30, source: "default" });
  });

  it("майбутнє замовлення: клієнт не «зник»; без замовлень у список не йде", async () => {
    await order("2026-09-01");
    await order("2026-12-05");
    expect(await ids()).toEqual([]);
    const empty = await createClient(t.db, t.users.owner, { name: "Без замовлень" });
    expect(await ids()).not.toContain(empty.id);
  });

  it("разовий клієнт і неактивний статус не потрапляють", async () => {
    await order("2026-09-01");
    expect(await ids()).toContain(t.client.id);
    await setClientOneTime(t.db, t.users.manager, t.client.id, true);
    expect(await ids()).toEqual([]);
    await setClientOneTime(t.db, t.users.owner, t.client.id, false);
    expect(await ids()).toContain(t.client.id);
    const [paused] = await t.db
      .select()
      .from(clientStatuses)
      .where(eq(clientStatuses.code, "paused"));
    const [active] = await t.db
      .select()
      .from(clientStatuses)
      .where(eq(clientStatuses.code, "active"));
    await t.db.update(clients).set({ statusId: paused!.id }).where(eq(clients.id, t.client.id));
    expect(await ids()).toEqual([]);
    await t.db.update(clients).set({ statusId: active!.id }).where(eq(clients.id, t.client.id));
  });

  it("власний поріг клієнта й загальний з налаштувань", async () => {
    await order("2026-11-10"); // 15 днів
    await t.db
      .update(clients)
      .set({ inactiveDaysThreshold: 10 })
      .where(eq(clients.id, t.client.id));
    expect((await findInactiveClients(t.db, { now }))[0]!.threshold).toEqual({
      days: 10,
      source: "client",
    });
    await t.db
      .update(clients)
      .set({ inactiveDaysThreshold: null })
      .where(eq(clients.id, t.client.id));
    expect(await ids()).toEqual([]);
    await setInactiveDays(t.db, t.users.owner, 14);
    expect(await loadInactiveDays(t.db)).toBe(14);
    expect(await ids()).toContain(t.client.id);
  });

  it("менеджер бачить лише своїх клієнтів", async () => {
    const other = await createClient(t.db, t.users.owner, { name: "Чужий", managerId: null });
    await order("2026-09-01");
    await order("2026-09-01", other.id);
    const owner = await listInactiveClients(t.db, t.users.owner, now);
    expect(owner.map((c) => c.clientId).sort()).toEqual([t.client.id, other.id].sort());
    const manager = await listInactiveClients(t.db, t.users.manager, now);
    expect(manager.map((c) => c.clientId)).toEqual([t.client.id]);
  });

  it("позначка зберігається з форми клієнта й видна в списку клієнтів", async () => {
    const created = await createClient(t.db, t.users.owner, {
      name: "Одноразовий",
      isOneTime: true,
    });
    const page = await listClients(t.db, t.users.owner, { search: "Одноразовий" });
    expect(page.items[0]).toMatchObject({ id: created.id, isOneTime: true });
    await updateClient(t.db, t.users.manager, created.id, { isOneTime: false });
    expect(
      (await listClients(t.db, t.users.owner, { search: "Одноразовий" })).items[0]!.isOneTime,
    ).toBe(false);
  });

  it("права: список для власника, менеджера, бухгалтера; позначати власник і менеджер; поріг власник", async () => {
    for (const role of USER_ROLES) {
      const list = listInactiveClients(t.db, t.users[role], now);
      if (["owner", "manager", "accountant"].includes(role))
        await expect(list, role).resolves.toBeTruthy();
      else await expect(list, role).rejects.toBeInstanceOf(ForbiddenError);
      const mark = setClientOneTime(t.db, t.users[role], t.client.id, false);
      if (["owner", "manager"].includes(role)) await expect(mark, role).resolves.toBeUndefined();
      else await expect(mark, role).rejects.toBeInstanceOf(ForbiddenError);
      const threshold = setInactiveDays(t.db, t.users[role], 30);
      if (role === "owner") await expect(threshold).resolves.toBeUndefined();
      else await expect(threshold, role).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(setInactiveDays(t.db, t.users.owner, 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(setInactiveDays(t.db, t.users.owner, 1.5)).rejects.toBeInstanceOf(ValidationError);
  });
});
