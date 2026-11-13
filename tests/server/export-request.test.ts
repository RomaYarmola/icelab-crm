import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataExports } from "@/db/schema";
import { isExportList, runExport } from "@/server/export-request";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { readXlsx } from "./xlsx-reader";

const rowsOf = (file: { buffer: Buffer }) => readXlsx(new Uint8Array(file.buffer)).sheets;

describe("експорт за адресою сторінки: параметри читаються як на екрані (B8, D92)", () => {
  let t: OrderTestContext;
  let confirmedId: string;

  beforeAll(async () => {
    t = await setupOrderTests();
    await t.create({ orderDate: "2033-02-10" });
    confirmedId = (await t.create({ orderDate: "2033-02-11" })).id;
    await transitionOrder(t.db, t.users.owner, confirmedId, "confirmed");
    await t.create({ orderDate: "2033-02-12" });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("знає лише чотири списки", () => {
    for (const list of ["orders", "clients", "cash", "all"]) expect(isExportList(list)).toBe(true);
    for (const list of ["boxes", "", "ORDERS", "../etc", "orders/1"]) {
      expect(isExportList(list), list).toBe(false);
    }
  });

  it("замовлення: дати, статус і пошук з адреси звужують файл так само, як екран", async () => {
    const all = await runExport(t.db, t.users.manager, "orders", {
      from: "2033-02-10",
      to: "2033-02-12",
    });
    expect(all.rowCount).toBe(3);

    const confirmed = await runExport(t.db, t.users.manager, "orders", {
      from: "2033-02-10",
      to: "2033-02-12",
      status: "confirmed",
    });
    expect(confirmed.rowCount).toBe(1);

    const oneDay = await runExport(t.db, t.users.accountant, "orders", {
      day: "today",
      from: "2033-02-12",
      to: "2033-02-12",
    });
    expect(oneDay.rowCount).toBe(1);

    // Невідомий статус і не-uuid менеджер відкидаються, а не ламають експорт (як на екрані).
    const garbage = await runExport(t.db, t.users.owner, "orders", {
      from: "2033-02-10",
      to: "2033-02-12",
      status: "zzz",
      manager: "не-uuid",
      delivery: "teleport",
    });
    expect(garbage.rowCount).toBe(3);
  });

  it("замовлення: вибір локації з шапки обмежує файл", async () => {
    const here = await runExport(
      t.db,
      t.users.owner,
      "orders",
      { from: "2033-02-10", to: "2033-02-12" },
      t.location,
    );
    expect(here.rowCount).toBe(3);
    const elsewhere = await runExport(
      t.db,
      t.users.owner,
      "orders",
      { from: "2033-02-10", to: "2033-02-12" },
      t.otherLocation,
    );
    expect(elsewhere.rowCount).toBe(0);
  });

  it("клієнти: пошук з адреси; видалених вмикає лише власник", async () => {
    const found = await runExport(t.db, t.users.manager, "clients", { q: "Кафе Тест" });
    expect(found.rowCount).toBe(1);
    const none = await runExport(t.db, t.users.manager, "clients", { q: "Немає такого" });
    expect(none.rowCount).toBe(0);

    const asManager = await runExport(t.db, t.users.manager, "clients", {
      q: "Кафе",
      deleted: "1",
    });
    expect(rowsOf(asManager)[0]!.rows[0]!.F).toBeUndefined();
    const asOwner = await runExport(t.db, t.users.owner, "clients", { q: "Кафе", deleted: "1" });
    expect(rowsOf(asOwner)[0]!.rows[0]!.F?.value).toBe("Видалено");
    // Менеджерові «З видаленими» не пишемо й у журнал: він цього не вмикав.
    const logs = await t.db.select().from(dataExports);
    const managerLog = logs.find(
      (l) => l.createdBy === t.users.manager.id && l.kind === "clients" && l.rowCount === 1,
    );
    expect(managerLog?.params).toEqual({ Пошук: "Кафе Тест" });
  });

  it("готівка: день з адреси (`date`), без параметра сьогодні, сміття дає сьогодні", async () => {
    const day = await runExport(t.db, t.users.accountant, "cash", { date: "2033-02-10" });
    expect(day.fileName).toBe("icelab-cash-2033-02-10.xlsx");
    const bad = await runExport(t.db, t.users.accountant, "cash", { date: "вчора" });
    expect(bad.fileName).toMatch(/^icelab-cash-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(bad.fileName).not.toContain("вчора");
  });

  it("«усе» ігнорує параметри адреси й потребує права власника", async () => {
    const file = await runExport(t.db, t.users.owner, "all", { q: "щось", status: "confirmed" });
    expect(file.kind).toBe("all");
    await expect(runExport(t.db, t.users.manager, "all", {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
