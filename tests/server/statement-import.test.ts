import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orders, paymentMatches, payments, settings } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import {
  applyMapping,
  excelSerialToText,
  guessMapping,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
  readStatementFile,
  StatementFileError,
} from "@/server/statement-file";
import {
  commitStatementImport,
  MAPPING_KEY,
  previewStatementImport,
} from "@/server/statement-import";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const enc = (text: string) => new TextEncoder().encode(text);

describe("розбір файла виписки (B13, фаза 4)", () => {
  it("CSV: роздільники, лапки, BOM, переноси всередині клітинки", () => {
    expect(parseCsv("﻿a;b;c\n1;2;3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv('a,b\n"x, y","он ""сказав""\nдалі"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'он "сказав"\nдалі'],
    ]);
    expect(parseCsv("a\tb\r\n1\t2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a;b\n\n;\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("дата: київський час, формати банку й Excel, літній час", () => {
    expect(parseStatementDate("23.11.2026 14:05:09")?.toISOString()).toBe(
      "2026-11-23T12:05:09.000Z",
    );
    expect(parseStatementDate("23.07.2026 14:05")?.toISOString()).toBe("2026-07-23T11:05:00.000Z");
    expect(parseStatementDate("2026-11-23 14:05")?.toISOString()).toBe("2026-11-23T12:05:00.000Z");
    expect(parseStatementDate("2026-11-23T12:05:00Z")?.toISOString()).toBe(
      "2026-11-23T12:05:00.000Z",
    );
    expect(parseStatementDate("23/11/2026")?.toISOString()).toBe("2026-11-22T22:00:00.000Z");
    expect(parseStatementDate("32.13.2026")).toBeNull();
    expect(parseStatementDate("вчора")).toBeNull();
    expect(excelSerialToText(46349.5)).toBe("2026-11-23 12:00:00");
  });

  it("сума: кома, крапка, пробіли, тисячі, мінус, валюта", () => {
    expect(parseStatementAmount("2 250,50")).toBe(225050);
    expect(parseStatementAmount("2250.5")).toBe(225050);
    expect(parseStatementAmount("1.234,56")).toBe(123456);
    expect(parseStatementAmount("1,234.56")).toBe(123456);
    expect(parseStatementAmount("2 250 ₴")).toBe(225000);
    expect(parseStatementAmount("-100")).toBe(-10000);
    expect(parseStatementAmount("2,250")).toBe(225000);
    expect(parseStatementAmount("abc")).toBeNull();
    expect(parseStatementAmount("")).toBeNull();
  });

  it("колонки: пропозиція за заголовками monobank і довільними", () => {
    const mono = guessMapping([
      "Дата i час операції",
      "Деталі операції",
      "MCC",
      "Сума в валюті картки (UAH)",
      "Сума в валюті операції",
      "Валюта",
      "Курс",
      "Сума комісій (UAH)",
      "Залишок після операції",
    ]);
    expect(mono).toMatchObject({
      date: "Дата i час операції",
      description: "Деталі операції",
      amount: "Сума в валюті картки (UAH)",
    });
    expect(guessMapping(["Date", "Amount", "Counterparty", "Comment"])).toMatchObject({
      date: "Date",
      amount: "Amount",
      counter: "Counterparty",
      comment: "Comment",
    });
  });

  const csv = [
    "Дата і час операції;Деталі операції;Сума в валюті картки (UAH)",
    "23.11.2026 10:00:00;Від: ТОВ «Кафе Тест»;2 250,00",
    "23.11.2026 11:00:00;Оплата за зв'язок;-300,00",
    "23.11.2026 12:00:00;Від: Бар Лев;1000,50",
    "не дата;Від: X;10",
    "23.11.2026 13:00:00;Від: Y;abc",
  ].join("\n");

  it("застосування: лише надходження, платник з «Від:», помилки з номером рядка", () => {
    const table = readStatementFile("v.csv", enc(csv));
    const parsed = applyMapping(table, guessMapping(table.headers));
    expect(parsed.rows.map((r) => [r.amountKopecks, r.counterName])).toEqual([
      [225000, "ТОВ «Кафе Тест»"],
      [100050, "Бар Лев"],
    ]);
    expect(parsed.skippedOutgoing).toBe(1);
    expect(parsed.errors.map((e) => e.line)).toEqual([5, 6]);
  });

  it("однакові рядки в одному файлі мають різні відбитки, а повтор файла дає ті самі", () => {
    const same = "Дата;Сума;Опис\n23.11.2026 10:00;100;Від: A\n23.11.2026 10:00;100;Від: A\n";
    const run = () => {
      const t = readStatementFile("v.csv", enc(same));
      return applyMapping(t, guessMapping(t.headers)).rows.map((r) => r.hash);
    };
    const first = run();
    expect(new Set(first).size).toBe(2);
    expect(run()).toEqual(first);
  });

  it("XLSX: перший аркуш, текст, числа й дати", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Дата</t></is></c><c r="B1" t="s"><v>0</v></c></row>
      <row r="2"><c r="A2" s="1"><v>46349.5</v></c><c r="B2"><v>2250.5</v></c></row>
    </sheetData></worksheet>`;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Сума</t></si></sst>"),
      "xl/styles.xml": strToU8(
        '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    const table = readStatementFile("v.xlsx", bytes);
    expect(table.headers).toEqual(["Дата", "Сума"]);
    expect(table.rows).toEqual([["2026-11-23 12:00:00", "2250.5"]]);
  });

  it("помилки файла: порожній, завеликий, старий .xls, зламаний zip, без рядків", () => {
    expect(() => readStatementFile("a.csv", new Uint8Array())).toThrow(StatementFileError);
    expect(() => readStatementFile("a.csv", new Uint8Array(3 * 1024 * 1024 + 1))).toThrow(
      /завеликий/,
    );
    expect(() => readStatementFile("a.xls", enc("x"))).toThrow(/\.xls/);
    expect(() => readStatementFile("a.xlsx", new Uint8Array([0x50, 0x4b, 1, 2]))).toThrow(
      StatementFileError,
    );
    expect(() => readStatementFile("a.csv", enc("Дата;Сума\n"))).toThrow(/немає рядків/);
  });
});

describe("імпорт виписки: перегляд, дублі, шаблон, права (B13, фаза 4)", () => {
  let t: OrderTestContext;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(paymentMatches);
    await t.db.delete(payments);
    await t.db.delete(settings).where(eq(settings.key, MAPPING_KEY));
  });

  const file = (text: string, name = "виписка.csv") => ({ name, bytes: enc(text) });
  const csv = [
    "Дата і час операції;Деталі операції;Сума в валюті картки (UAH)",
    "23.11.2026 10:00:00;Від: Кафе Тест;2250,00",
    "23.11.2026 11:00:00;Від: Бар Лев;1000,00",
    "23.11.2026 12:00:00;Витрата;-50,00",
  ].join("\n");

  it("перегляд нічого не пише й показує нові платежі", async () => {
    const preview = await previewStatementImport(t.db, t.users.accountant, file(csv));
    expect(preview).toMatchObject({
      total: 3,
      fresh: 2,
      duplicates: 0,
      skippedOutgoing: 1,
      fromTemplate: false,
    });
    expect(preview.mapping.amount).toBe("Сума в валюті картки (UAH)");
    expect(await t.db.select().from(payments)).toHaveLength(0);
  });

  it("імпорт записує платежі зі статусом «файл»; повторний імпорт того самого файла нічого не додає", async () => {
    const mapping = (await previewStatementImport(t.db, t.users.owner, file(csv))).mapping;
    const first = await commitStatementImport(t.db, t.users.owner, file(csv), mapping);
    expect(first).toMatchObject({ inserted: 2, duplicates: 0 });
    const rows = await t.db.select().from(payments);
    expect(rows.every((r) => r.importedVia === "file" && r.dedupeHash)).toBe(true);
    const second = await commitStatementImport(t.db, t.users.owner, file(csv), mapping);
    expect(second).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(await t.db.select().from(payments)).toHaveLength(2);
    expect((await previewStatementImport(t.db, t.users.owner, file(csv))).fresh).toBe(0);
  });

  it("схожий на платіж з API (та сама сума в межах хвилини) вважається дублем", async () => {
    await t.db.insert(payments).values({
      externalId: "api-1",
      occurredAt: new Date("2026-11-23T08:00:20Z"),
      amount: "2250.00",
    });
    const preview = await previewStatementImport(t.db, t.users.owner, file(csv));
    expect(preview).toMatchObject({ fresh: 1, duplicates: 1 });
  });

  it("шаблон колонок зберігається й застосовується до наступного файла", async () => {
    const custom = "Коли;Скільки;Хто\n23.11.2026 10:00;100;Тест\n";
    const mapping = {
      date: "Коли",
      amount: "Скільки",
      description: null,
      counter: "Хто",
      comment: null,
    };
    await commitStatementImport(t.db, t.users.owner, file(custom), mapping);
    const next = await previewStatementImport(
      t.db,
      t.users.owner,
      file("Коли;Скільки;Хто\n24.11.2026 10:00;200;Інший\n"),
    );
    expect(next).toMatchObject({ fromTemplate: true, fresh: 1 });
    expect(next.mapping).toEqual(mapping);
    // файл з іншими колонками шаблон не застосовує
    const other = await previewStatementImport(t.db, t.users.owner, file(csv));
    expect(other.fromTemplate).toBe(false);
  });

  it("після імпорту платіж з номером замовлення зіставляється сам", async () => {
    const { id } = await t.create({
      paymentKind: "fop",
      orderDate: new Date().toISOString().slice(0, 10),
    });
    await transitionOrder(t.db, t.users.owner, id, "confirmed");
    const number = (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.number;
    const text = `Дата;Сума;Призначення\n23.11.2026 10:00;2250;Оплата за замовлення №${number}\n`;
    const preview = await previewStatementImport(t.db, t.users.owner, file(text));
    const result = await commitStatementImport(t.db, t.users.owner, file(text), preview.mapping);
    expect(result).toMatchObject({ inserted: 1, matched: 1 });
    expect(await t.db.select().from(paymentMatches)).toHaveLength(1);
  });

  it("помилки: не вибрано колонки; права лише власнику й бухгалтеру", async () => {
    await expect(
      commitStatementImport(t.db, t.users.owner, file(csv), {
        date: null,
        amount: null,
        description: null,
        counter: null,
        comment: null,
      }),
    ).rejects.toBeInstanceOf(StatementFileError);
    for (const role of USER_ROLES) {
      const attempt = previewStatementImport(t.db, t.users[role], file(csv));
      if (role === "owner" || role === "accountant")
        await expect(attempt, role).resolves.toBeTruthy();
      else await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
