import { describe, expect, it } from "vitest";
import {
  buildWorkbook,
  instantToKyivExcel,
  isoDateToExcel,
  safeText,
  sheetName,
  sheetOf,
  type ExportColumn,
} from "@/server/export-xlsx";
import { excelSerial, readXlsx, sheetValues } from "./xlsx-reader";

type Row = {
  n: number;
  day: string | null;
  at: string | null;
  client: string;
  phone: string | null;
  sum: string | null;
  paid: boolean;
};

const columns: ExportColumn<Row>[] = [
  { header: "№", kind: "number", value: (r) => r.n },
  { header: "Дата", kind: "date", value: (r) => r.day },
  { header: "Створено", kind: "datetime", value: (r) => r.at },
  { header: "Клієнт", kind: "text", value: (r) => r.client },
  { header: "Телефон", kind: "phone", value: (r) => r.phone },
  { header: "Сума", kind: "money", value: (r) => r.sum },
  { header: "Сплачено", kind: "bool", value: (r) => r.paid },
];

const rows: Row[] = [
  {
    n: 1,
    day: "2026-11-13",
    at: "2026-11-13T10:05:00Z",
    client: "Кафе «Вогник»",
    phone: "+380501234567",
    sum: "1234.50",
    paid: true,
  },
  { n: 2, day: null, at: null, client: "=1+1", phone: "0501234567", sum: null, paid: false },
];

async function read(sheetRows: Row[] = rows, name = "Замовлення") {
  const buffer = await buildWorkbook([sheetOf({ name, columns, rows: sheetRows })]);
  return readXlsx(new Uint8Array(buffer));
}

describe("файл XLSX для експорту", () => {
  it("має заголовки українською, заморожений рядок, автофільтр і ширини колонок", async () => {
    const { sheets } = await read();
    const sheet = sheets[0]!;
    expect(sheet.name).toBe("Замовлення");
    expect(sheetValues(sheet, ["A", "B", "C", "D", "E", "F", "G"])[0]).toEqual([
      "№",
      "Дата",
      "Створено",
      "Клієнт",
      "Телефон",
      "Сума",
      "Сплачено",
    ]);
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.autoFilter).toBe("A1:G3");
    expect(sheet.widths).toHaveLength(7);
    // Широка колонка з довгим текстом ширша за мінімум, вузька не менша за мінімум.
    expect(sheet.widths[3]).toBeGreaterThan("Кафе «Вогник»".length);
    expect(Math.min(...sheet.widths)).toBeGreaterThanOrEqual(8);
  });

  it("заголовок вміщується разом із кнопкою автофільтра (Excel закриває нею кінець підпису)", async () => {
    const { sheets } = await read();
    const sheet = sheets[0]!;
    columns.forEach((column, index) => {
      // Жирний підпис плюс кнопка фільтра: запас більший за довжину тексту хоча б на 3 символи.
      expect(sheet.widths[index], column.header).toBeGreaterThanOrEqual(column.header.length + 3);
    });
  });

  it("Excel не позначає зеленим трикутником текст, схожий на число (телефони, коди), а елементи стоять у правильному порядку", async () => {
    const { sheets } = await read();
    const sheet = sheets[0]!;
    expect(sheet.ignoredErrors).toBe("A2:G3");
    expect(sheet.xml).toContain('numberStoredAsText="1"');
    // Порядок елементів аркуша за специфікацією: дані, автофільтр, ігноровані помилки. Інакше Excel
    // вважає файл пошкодженим.
    const order = ["<sheetViews", "<cols", "<sheetData", "<autoFilter", "<ignoredErrors"].map(
      (tag) => sheet.xml.indexOf(tag),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sheet.xml.endsWith("</worksheet>")).toBe(true);
    // Порожній аркуш (лише заголовки) не має що ігнорувати.
    const empty = (await read([])).sheets[0]!;
    expect(empty.ignoredErrors).toBeNull();
    expect(empty.xml).not.toContain("<ignoredErrors");
  });

  it("дати це справжні дати Excel, а не текст, і без зсуву часового поясу", async () => {
    const { sheets } = await read();
    const [, first, second] = sheets[0]!.rows;
    expect(first!.B).toMatchObject({ type: "n", value: excelSerial(2026, 11, 13) });
    expect(first!.B!.format).toBe("dd.mm.yyyy");
    // 10:05 UTC це 12:05 за Києвом узимку: Excel має показати київський годинник.
    expect(first!.C).toMatchObject({ type: "n", value: excelSerial(2026, 11, 13, 12, 5) });
    expect(first!.C!.format).toBe("dd.mm.yyyy hh:mm");
    expect(second!.B).toBeUndefined();
    expect(second!.C).toBeUndefined();
  });

  it("літом київський час на три години більший за UTC", () => {
    const summer = instantToKyivExcel("2026-07-01T10:00:00Z")!;
    expect(summer.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    const winter = instantToKyivExcel("2026-12-01T10:00:00Z")!;
    expect(winter.toISOString()).toBe("2026-12-01T12:00:00.000Z");
    expect(instantToKyivExcel("не дата")).toBeNull();
    expect(isoDateToExcel("2026-11-13")?.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(isoDateToExcel("13.11.2026")).toBeNull();
  });

  it("числа й гроші це числа, гроші з форматом у дві цифри", async () => {
    const { sheets } = await read();
    const [, first, second] = sheets[0]!.rows;
    expect(first!.A).toMatchObject({ type: "n", value: 1 });
    expect(first!.F).toMatchObject({ type: "n", value: 1234.5 });
    expect(first!.F!.format).toBe("#,##0.00");
    expect(second!.F).toBeUndefined();
  });

  it("телефон лишається текстом: початковий 0 і «+» не губляться", async () => {
    const { sheets } = await read();
    const [, first, second] = sheets[0]!.rows;
    expect(first!.E).toMatchObject({ type: "s", value: "+380501234567" });
    expect(second!.E).toMatchObject({ type: "s", value: "0501234567" });
  });

  it("«формули» з тексту не стають формулами й отримують апостроф", async () => {
    const hostile = ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"];
    const { sheets } = await read(hostile.map((client, i) => ({ ...rows[1]!, n: i, client })));
    const sheet = sheets[0]!;
    // Жодної формули (елемента `<f>`) у файлі немає.
    expect(sheet.xml).not.toMatch(/<f[\s>]/);
    for (let i = 1; i <= hostile.length; i++) {
      const cell = sheet.rows[i]!.D!;
      expect(cell.type).toBe("s");
      expect(String(cell.value).startsWith("'")).toBe(true);
    }
  });

  it("звичайний текст і числоподібні рядки не псуємо", () => {
    expect(safeText("Кафе «Вогник»")).toBe("Кафе «Вогник»");
    expect(safeText("+380 50 123-45-67")).toBe("+380 50 123-45-67");
    expect(safeText("-5")).toBe("-5");
    expect(safeText("1+1")).toBe("1+1");
    expect(safeText("-термінова")).toBe("'-термінова");
  });

  it("прибирає символи, яких не буває в XML, і обрізає надто довгий текст", async () => {
    expect(safeText("а\u0000б\u0007в")).toBe("абв");
    expect(safeText("я".repeat(40_000)).length).toBeLessThan(32_767);
    const { sheets } = await read([{ ...rows[0]!, client: "а\u0000б & <b>" }]);
    expect(sheets[0]!.rows[1]!.D!.value).toBe("аб & <b>");
  });

  it("булеве значення стає «Так» чи «Ні»", async () => {
    const { sheets } = await read();
    expect(sheets[0]!.rows[1]!.G!.value).toBe("Так");
    expect(sheets[0]!.rows[2]!.G!.value).toBe("Ні");
  });

  it("порожній список дає файл лише із заголовками", async () => {
    const { sheets } = await read([]);
    expect(sheets[0]!.rows).toHaveLength(1);
    expect(sheets[0]!.autoFilter).toBe("A1:G1");
  });

  it("кілька аркушів: назви без заборонених символів, до 31 знака, без повторів", async () => {
    const buffer = await buildWorkbook([
      sheetOf({ name: "Клієнти: [усі]/?", columns, rows: [] }),
      sheetOf({ name: "Клієнти: [усі]/?", columns, rows: [] }),
      sheetOf({
        name: "Дуже довга назва аркуша, яка не вміщується в 31 символ",
        columns,
        rows: [],
      }),
    ]);
    const names = readXlsx(new Uint8Array(buffer)).sheets.map((s) => s.name);
    expect(names).toHaveLength(3);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[[\]:*?/\\]/);
    }
    expect(sheetName("", new Set())).toBe("Аркуш");
  });

  it("файл починається як ZIP (PK) і має обов'язкові частини XLSX", async () => {
    const buffer = await buildWorkbook([sheetOf({ name: "А", columns, rows })]);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const { files } = readXlsx(new Uint8Array(buffer));
    expect(files).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
        "xl/styles.xml",
      ]),
    );
  });
});
