import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, co2Adjustments, locations } from "@/db/schema";
import { listAuditEntries } from "@/server/audit";
import {
  addCo2Receipt,
  addIceWriteoff,
  deleteCo2Entry,
  getCo2Page,
  setCo2Norm,
  setCo2Stock,
} from "@/server/finance/co2";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { type OrderTestContext, ORDER_DATE, setupOrderTests } from "./order-helpers";

const TODAY = "2026-11-20";

describe("сировина CO2: серверні функції (B15, фаза Б2)", () => {
  let t: OrderTestContext;
  let code: string;

  beforeAll(async () => {
    t = await setupOrderTests();
    code = (await t.db.select().from(locations).where(eq(locations.id, t.location)))[0]!.code;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const page = () => getCo2Page(t.db, t.users.owner, { location: code, today: TODAY });

  it("бачить і змінює лише власник", async () => {
    for (const actor of [t.users.manager, t.users.accountant, t.users.location_lead]) {
      await expect(getCo2Page(t.db, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        addIceWriteoff(t.db, actor, { locationId: t.location, writtenOffOn: TODAY, kg: 1 }, TODAY),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("перевіряє введене: кількість, ціна, дата не в майбутньому", async () => {
    const base = { locationId: t.location, receivedOn: TODAY, kg: "100", pricePerKg: "30" };
    for (const bad of [
      { kg: "0" },
      { kg: "abc" },
      { pricePerKg: "" },
      { receivedOn: "2026-11-21" },
    ]) {
      await expect(
        addCo2Receipt(t.db, t.users.owner, { ...base, ...bad }, TODAY),
      ).rejects.toThrow();
    }
    await expect(
      setCo2Stock(t.db, t.users.owner, { locationId: t.location, actualKg: 5, note: "x" }, TODAY),
    ).rejects.toThrow("Спершу додайте прихід");
  });

  it("лід підтверджених замовлень і списаний лід зменшують залишок; чернетки й скасовані ні", async () => {
    await setCo2Norm(t.db, t.users.owner, {
      locationId: t.location,
      validFrom: "2026-01-01",
      norm: "2,7",
    });
    await addCo2Receipt(
      t.db,
      t.users.owner,
      { locationId: t.location, receivedOn: "2026-11-01", kg: "1000", pricePerKg: "30,50" },
      TODAY,
    );
    const confirmed = await t.create({ kgSold: 30, kgToProduce: "33" });
    await transitionOrder(t.db, t.users.owner, confirmed.id, "confirmed");
    await t.create({ kgToProduce: "100" });
    const cancelled = await t.create({ kgToProduce: "100" });
    await transitionOrder(t.db, t.users.owner, cancelled.id, "cancelled", { note: "тест" });

    expect(ORDER_DATE <= TODAY).toBe(true);
    let data = await page();
    expect(data.stockKg).toBe(1000 - 33 * 2.7);
    expect(data.months[0]!.orders).toEqual({ iceKg: 33, co2Kg: 89.1, cost: "2717.55" });

    await addIceWriteoff(
      t.db,
      t.users.owner,
      { locationId: t.location, writtenOffOn: TODAY, kg: "10" },
      TODAY,
    );
    data = await page();
    expect(data.stockKg).toBeCloseTo(1000 - 43 * 2.7, 3);
    expect(data.months[0]!.writeoffs.co2Kg).toBe(27);
  });

  it("виправлення залишку зберігає різницю; повтор того самого числа відхиляється", async () => {
    const input = { locationId: t.location, actualKg: "800", note: "Звірили за вагами" };
    await setCo2Stock(t.db, t.users.owner, input, TODAY);
    expect((await page()).stockKg).toBe(800);
    const [row] = await t.db.select().from(co2Adjustments);
    expect(Number(row!.kg)).toBeCloseTo(800 - (1000 - 43 * 2.7), 3);
    expect(row!.createdBy).toBe(t.users.owner.id);
    await expect(setCo2Stock(t.db, t.users.owner, input, TODAY)).rejects.toThrow("уже такий");
    await expect(
      setCo2Stock(t.db, t.users.owner, { ...input, actualKg: 700, note: " " }, TODAY),
    ).rejects.toThrow("чому виправляєте");
  });

  it("норма на ту саму дату замінюється; запис можна видалити, а повторно ні", async () => {
    const input = { locationId: t.location, validFrom: "2026-01-01", norm: 3 };
    await setCo2Norm(t.db, t.users.owner, input);
    const data = await page();
    expect(data.norms).toHaveLength(1);
    expect(data.norm).toBe(3);
    const id = data.writeoffs[0]!.id;
    await deleteCo2Entry(t.db, t.users.owner, "writeoff", id);
    expect((await page()).writeoffs).toEqual([]);
    await expect(deleteCo2Entry(t.db, t.users.owner, "writeoff", id)).rejects.toThrow(
      "уже видалено",
    );
  });

  it("записи CO2 є в журналі власника й приховані від бухгалтера", async () => {
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "co2_receipts"), eq(auditLog.actorId, t.users.owner.id)));
    expect(entry).toBeDefined();
    const owner = await listAuditEntries(t.db, t.users.owner, { section: "finance" });
    expect(owner.items.length).toBeGreaterThan(0);
    const accountant = await listAuditEntries(t.db, t.users.accountant, { section: "finance" });
    expect(accountant.items).toEqual([]);
  });
});
