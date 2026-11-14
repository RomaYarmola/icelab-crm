import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxTypes, locations } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  addLegacyDebt,
  listBoxDebts,
  listBoxStock,
  listClientBoxes,
  listLegacyDebts,
  resolveLegacyDebt,
} from "@/server/box-debts";
import { boxWord, debtReminderText } from "@/utils/boxDebtText";
import { createBoxes, recordBoxEvent } from "@/server/boxes";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { exportBoxDebts, exportBoxes, exportBoxStock, exportEverything } from "@/server/export";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { readXlsx, sheetValues } from "./xlsx-reader";

describe("борги, старі борги, склад (B9, D113, D114)", () => {
  let t: OrderTestContext;
  let typeId: string;
  const lead = () => t.users.location_lead;
  const owner = () => t.users.owner;

  beforeAll(async () => {
    t = await setupOrderTests();
    typeId = (await t.db.select().from(boxTypes)).find((x) => !x.isClientOwned)!.id;
    await t.db.update(locations).set({ boxPrefix: "T" }).where(eq(locations.id, t.location));
    await t.db.update(locations).set({ boxPrefix: "U" }).where(eq(locations.id, t.otherLocation));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const issue = async (count: number) => {
    const created = await t.create({ orderDate: "2034-01-10" });
    await transitionOrder(t.db, owner(), created.id, "confirmed");
    await transitionOrder(t.db, lead(), created.id, "in_production");
    const { codes } = await createBoxes(t.db, owner(), {
      boxTypeId: typeId,
      locationId: t.location,
      count,
    });
    for (const code of codes) {
      await recordBoxEvent(t.db, lead(), { code, action: "issue", orderId: created.id });
    }
    return codes;
  };

  it("борг = бокси «У клієнта»; повернений бокс з боргу зникає", async () => {
    const [first, second] = await issue(2);
    let debts = await listBoxDebts(t.db, owner(), { clientId: t.client.id });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ total: 2, qrCount: 2, legacyCount: 0, boxTypeId: typeId });
    expect(debts[0]!.days).toBeGreaterThanOrEqual(0);
    expect(debts[0]!.oldestDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await recordBoxEvent(t.db, lead(), { code: first!, action: "return" });
    debts = await listBoxDebts(t.db, owner(), { clientId: t.client.id });
    expect(debts[0]!.total).toBe(1);
    const items = await listClientBoxes(t.db, owner(), t.client.id);
    expect(items.map((i) => i.code)).toEqual([second]);
  });

  it("старі борги додаються до боргу й закриваються частинами", async () => {
    const { id } = await addLegacyDebt(t.db, lead(), {
      clientId: t.client.id,
      boxTypeId: typeId,
      count: 3,
      sinceDate: "2025-12-01",
      note: "рядок 15",
    });
    let debts = await listBoxDebts(t.db, owner(), { clientId: t.client.id });
    expect(debts[0]).toMatchObject({ legacyCount: 3, qrCount: 1, total: 4 });
    // Старіший за QR-бокс: найдавніша дата береться зі старого боргу.
    expect(debts[0]!.oldestDay).toBe("2025-12-01");

    expect((await resolveLegacyDebt(t.db, lead(), { id, count: 2 })).openCount).toBe(1);
    debts = await listBoxDebts(t.db, owner(), { clientId: t.client.id });
    expect(debts[0]!.total).toBe(2);
    await expect(resolveLegacyDebt(t.db, lead(), { id, count: 2 })).rejects.toThrow(
      ValidationError,
    );
    await resolveLegacyDebt(t.db, lead(), { id, count: 1 });
    expect(await listLegacyDebts(t.db, owner(), { clientId: t.client.id })).toEqual([]);
  });

  it("перевірки введення й права", async () => {
    const base = { clientId: t.client.id, boxTypeId: typeId, count: 1 };
    await expect(addLegacyDebt(t.db, owner(), { ...base, count: 0 })).rejects.toThrow(
      ValidationError,
    );
    await expect(addLegacyDebt(t.db, owner(), { ...base, count: 1.5 })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      addLegacyDebt(t.db, owner(), { ...base, clientId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(ValidationError);
    await expect(addLegacyDebt(t.db, t.users.manager, base)).rejects.toThrow(ForbiddenError);
    await expect(addLegacyDebt(t.db, t.users.production, base)).rejects.toThrow(ForbiddenError);
  });

  it("виробництво боргів не бачить, менеджер і бухгалтер бачать", async () => {
    await expect(listBoxDebts(t.db, t.users.production)).rejects.toThrow(ForbiddenError);
    await expect(listClientBoxes(t.db, t.users.production, t.client.id)).rejects.toThrow(
      ForbiddenError,
    );
    expect((await listBoxDebts(t.db, t.users.manager)).length).toBeGreaterThan(0);
    expect((await listBoxDebts(t.db, t.users.accountant)).length).toBeGreaterThan(0);
  });

  it("склад: підрахунок по статусах, старший бачить лише свою локацію", async () => {
    await createBoxes(t.db, owner(), { boxTypeId: typeId, locationId: t.otherLocation, count: 2 });
    const all = await listBoxStock(t.db, owner());
    const own = all.find((r) => r.locationId === t.location && r.boxTypeId === typeId)!;
    expect(own.atClient).toBe(1);
    expect(own.inStock).toBeGreaterThanOrEqual(1);
    expect(all.some((r) => r.locationId === t.otherLocation)).toBe(true);

    const leadView = await listBoxStock(t.db, lead());
    expect(leadView.every((r) => r.locationId === t.location)).toBe(true);
    const filtered = await listBoxStock(t.db, owner(), { locationId: t.otherLocation });
    expect(filtered.every((r) => r.locationId === t.otherLocation)).toBe(true);
  });

  it("переміщення в іншу локацію міняє склад (лише власник)", async () => {
    const { codes } = await createBoxes(t.db, owner(), {
      boxTypeId: typeId,
      locationId: t.location,
      count: 1,
    });
    await expect(
      recordBoxEvent(t.db, lead(), {
        code: codes[0]!,
        action: "transfer",
        toLocationId: t.otherLocation,
      }),
    ).rejects.toThrow(ForbiddenError);
    await recordBoxEvent(t.db, owner(), {
      code: codes[0]!,
      action: "transfer",
      toLocationId: t.otherLocation,
    });
    const stock = await listBoxStock(t.db, owner(), { locationId: t.otherLocation });
    expect(stock.find((r) => r.boxTypeId === typeId)!.inStock).toBeGreaterThanOrEqual(3);
  });

  it("текст нагадування й відмінок слова «бокс»", () => {
    expect([1, 2, 5, 11, 21, 22].map(boxWord)).toEqual([
      "бокс",
      "бокси",
      "боксів",
      "боксів",
      "бокс",
      "бокси",
    ]);
    const text = debtReminderText({ total: 2, boxTypeName: "Наш довгий", oldestDay: "2034-01-10" });
    expect(text).toContain("2 бокси «Наш довгий»");
    expect(text).toContain("10.01.2034");
    expect(text).toContain("IceLab");
  });

  describe("експорт боксів (D115)", () => {
    const sheetOf = (file: { buffer: Buffer }, name: string) =>
      readXlsx(file.buffer).sheets.find((x) => x.name === name)!;

    it("реєстр: вибір локації звужує файл, старший локації не вивантажує (немає права)", async () => {
      const mine = await exportBoxes(t.db, owner(), { locationId: t.location });
      const codes = sheetValues(sheetOf(mine, "Бокси"), ["A"]).flat();
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.every((c) => String(c).startsWith("T-") || c === "Код")).toBe(true);
      const all = await exportBoxes(t.db, owner());
      expect(sheetOf(all, "Бокси").rows.length).toBeGreaterThan(codes.length);
      await expect(exportBoxes(t.db, lead())).rejects.toThrow(ForbiddenError);
    });

    it("борги й склад мають заголовки та дані", async () => {
      const debts = await exportBoxDebts(t.db, t.users.accountant);
      expect(sheetOf(debts, "Борги по боксах").rows.length).toBeGreaterThan(1);
      const stock = await exportBoxStock(t.db, owner(), { locationId: t.otherLocation });
      const values = sheetValues(sheetOf(stock, "Склад боксів"), ["A", "C"]);
      expect(values.length).toBeGreaterThan(1);
    });

    it("права: виробництву, водієві й менеджеру в реєстрі відмовлено", async () => {
      await expect(exportBoxDebts(t.db, t.users.production)).rejects.toThrow(ForbiddenError);
      await expect(exportBoxes(t.db, t.users.manager)).rejects.toThrow(ForbiddenError);
      await expect(exportBoxes(t.db, t.users.production)).rejects.toThrow(ForbiddenError);
      await expect(exportBoxes(t.db, t.users.driver)).rejects.toThrow(ForbiddenError);
    });

    it("«Експорт усього» має аркуші боксів, подій і старих боргів", async () => {
      const file = await exportEverything(t.db, owner());
      const names = readXlsx(file.buffer).sheets.map((x) => x.name);
      expect(names).toEqual(expect.arrayContaining(["Бокси", "Події боксів", "Старі борги"]));
    });
  });
});
