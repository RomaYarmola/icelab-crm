import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataExports } from "@/db/schema";
import { runExport } from "@/server/export-request";
import {
  closeMonth,
  getMonthPage,
  getMonthReport,
  saveLedgerEntries,
  setUsdRate,
} from "@/server/finance/month";
import { buildReport, type ColumnInput } from "@/server/finance/month-rules";
import { buildReportTable, toUsdTable } from "@/server/finance/report-rows";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";
import { readXlsx } from "./xlsx-reader";

const MONTH = "2026-11";
const TODAY = "2026-12-05";

const column = (locationId: string | null, name: string, ice = 0): ColumnInput => ({
  locationId,
  name,
  revenue: { ice, delivery: 0, boxes: 0, other: 0 },
  otherIncome: [],
  co2: { orders: 0, writeoffs: 0, shortageGrams: 0 },
  expenses: [],
  commissions: [],
});

describe("рядки звіту (B15, Б4)", () => {
  const report = buildReport({
    month: MONTH,
    usdRate: 40,
    columns: [
      {
        ...column("k", "Київ", 100_000),
        expenses: [{ label: "Паливо", kopecks: 10_000 }],
        commissions: [{ profileId: "m", name: "Менеджер", grams: 10_000, rateKopecks: 200 }],
      },
      {
        ...column("l", "Львів", 50_000),
        commissions: [{ profileId: "m", name: "Менеджер", grams: 5_000, rateKopecks: 200 }],
      },
      { ...column(null, "Спільні"), expenses: [{ label: "Бухгалтер", kopecks: 8_000 }] },
    ],
  });
  const table = buildReportTable(report);
  const row = (label: string) => table.rows.find((item) => item.label === label)!;

  it("колонки лише міст, спільне входить тільки в «Разом»", () => {
    expect(table.cities).toEqual(["Київ", "Львів"]);
    expect(row("Бухгалтер")).toMatchObject({ values: [0, 0], total: 8_000 });
    expect(row("Комісія: Менеджер")).toMatchObject({ values: [2_000, 1_000], total: 3_000 });
  });

  it("підсумки й результат збігаються з рядками; порожні статті приховано", () => {
    expect(row("Разом доходи")).toMatchObject({ values: [100_000, 50_000], total: 150_000 });
    expect(row("Разом витрати")).toMatchObject({ values: [12_000, 1_000], total: 21_000 });
    expect(row("Результат")).toMatchObject({ values: [88_000, 49_000], total: 129_000 });
    expect(table.rows.map((item) => item.label)).not.toContain("Бокси");
    expect(table.rows.at(-1)!.kind).toBe("result");
  });

  it("долари за курсом місяця", () => {
    expect(toUsdTable(table, 40).rows.at(-1)!.total).toBe(3_225);
  });
});

describe("звіт і вивантаження в Excel", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
    const { id } = await t.create({ kgSold: 30 });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const report = () => getMonthReport(t.db, t.users.owner, { month: MONTH, today: TODAY });

  it("бачить і вивантажує лише власник", async () => {
    for (const actor of [t.users.manager, t.users.accountant, t.users.location_lead]) {
      await expect(getMonthReport(t.db, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        runExport(t.db, actor, "finance-report", { month: MONTH }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("без курсу лише аркуш у гривнях; з курсом є й долари; експорт записано в журнал", async () => {
    let file = await runExport(t.db, t.users.owner, "finance-report", { month: MONTH });
    expect(file.fileName).toBe("icelab-finance-2026-11.xlsx");
    expect(readXlsx(new Uint8Array(file.buffer)).sheets.map((s) => s.name)).toEqual(["Звіт, грн"]);

    await setUsdRate(t.db, t.users.owner, { month: MONTH, usdRate: 50 });
    file = await runExport(t.db, t.users.owner, "finance-report", { month: MONTH });
    const book = readXlsx(new Uint8Array(file.buffer));
    expect(book.sheets.map((s) => s.name)).toEqual(["Звіт, грн", "Звіт, дол"]);
    const rows = book.sheets[0]!.rows;
    expect(rows[0]!.A!.value).toBe("Стаття");
    expect(rows[1]!.A!.value).toBe("Лід");
    expect(rows.at(-1)!.A!.value).toBe("Результат");
    // «Разом» це остання колонка: міст у тестовій базі більше, ніж два.
    const total = (row: (typeof rows)[number]) => Object.values(row).at(-1)!.value;
    expect(total(rows.at(-1)!)).toBe(2250);
    expect(total(book.sheets[1]!.rows.at(-1)!)).toBe(45);
    expect((await t.db.select().from(dataExports)).map((r) => r.kind)).toContain("finance_report");
  });

  it("зміна витрат одного місяця не змінює інший (критерій ТЗ), закритий не змінюється зовсім", async () => {
    const page = await getMonthPage(t.db, t.users.owner, { month: MONTH, today: TODAY });
    const categoryId = page.categories.find((c) => c.kind === "expense")?.id;
    // Статті записує міграція, тож вони є й у тестовій базі.
    expect(categoryId).toBeDefined();
    await closeMonth(t.db, t.users.owner, { month: MONTH }, TODAY);
    const before = (await report()).report;
    await saveLedgerEntries(t.db, t.users.owner, {
      month: "2026-10",
      locationId: null,
      amounts: [{ categoryId: categoryId!, amount: "999" }],
    });
    expect((await report()).report).toEqual(before);
    expect((await report()).closedAt).not.toBeNull();
  });
});
