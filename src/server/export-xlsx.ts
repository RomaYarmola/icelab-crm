import writeExcelFile from "write-excel-file/node";
import {
  getCellAddress,
  getClosingTagMarkup,
  getOpeningTagMarkup,
  getOrderOfSiblings,
  getSelfClosingTagMarkup,
  insertElementMarkupAccordingToOrderOfSiblings,
} from "write-excel-file/utility";

/**
 * Збирання файлу XLSX для експорту (B8, D93). Чистий модуль без бази: на вхід аркуші з колонками й
 * рядками, на вихід байти файлу. Правила з рішення D93:
 *  - українські заголовки, жирні, заморожений перший рядок, автофільтр, ширини колонок за змістом;
 *  - дати це справжні дати Excel (київська дата без зсуву пояса), числа це числа;
 *  - телефон це текст, щоб не губились початковий 0 і «+»;
 *  - текст, що починається з `=`, `+`, `-`, `@`, не стає формулою: у файлі він лежить рядком, а на
 *    випадок повторного введення клітинки в Excel додаємо апостроф.
 */

export type ExportKind =
  | "text"
  /** Телефон: завжди текст. */
  | "phone"
  /** Ціле число або кількість без формату. */
  | "number"
  /** Гроші з двома знаками після коми. */
  | "money"
  /** Дата `YYYY-MM-DD` як справжня дата Excel. */
  | "date"
  /** Момент часу (ISO) у київському часі як справжня дата з часом. */
  | "datetime"
  /** «Так» чи «Ні». */
  | "bool";

export type ExportColumn<Row> = {
  header: string;
  kind: ExportKind;
  /** Значення клітинки: рядок, число або порожньо. Для `date` це `YYYY-MM-DD`, для `datetime` ISO. */
  value: (row: Row) => string | number | boolean | Date | null | undefined;
  /** Мінімальна ширина в символах (за замовчуванням за видом). */
  minWidth?: number;
};

export type ExportSheet<Row = unknown> = {
  name: string;
  columns: ExportColumn<Row>[];
  rows: Row[];
};

/** Стирає тип рядка, щоб аркуші з різними рядками лежали в одному списку. */
export function sheetOf<Row>(sheet: ExportSheet<Row>): ExportSheet<unknown> {
  return sheet as unknown as ExportSheet<unknown>;
}

/** Найбільше символів у клітинці (межа Excel 32 767, лишаємо запас). */
const MAX_CELL_LENGTH = 32_000;
const MAX_SHEET_NAME = 31;
/** Скільки рядків дивимось, щоб підібрати ширину колонки. */
const WIDTH_SAMPLE = 500;
const MAX_WIDTH = 60;
/** Жирний текст заголовка займає більше місця, ніж звичайний. */
const HEADER_FACTOR = 1.15;
/** Кнопка автофільтра в заголовку, у символах ширини колонки. */
const FILTER_BUTTON = 3;

const MIN_WIDTH: Record<ExportKind, number> = {
  text: 12,
  phone: 16,
  number: 10,
  money: 12,
  date: 12,
  datetime: 17,
  bool: 8,
};

const DATE_FORMAT = "dd.mm.yyyy";
const DATETIME_FORMAT = "dd.mm.yyyy hh:mm";
const MONEY_FORMAT = "#,##0.00";

/** Керівні символи, яких не буває в XML 1.0 (крім табуляції й переносу рядка). */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
/** Початок, з якого Excel може прочитати текст як формулу. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Безпечні «числові» тексти на кшталт телефону `+380 50 123-45-67` чи `-5`. */
const NUMBER_LIKE = /^[+-]?[\d\s().,-]+$/;

/** Текст клітинки без символів, що ламають XML, обрізаний до межі Excel і знешкоджений від формул. */
export function safeText(value: string): string {
  let text = value.replace(XML_ILLEGAL, "");
  if (text.length > MAX_CELL_LENGTH) text = `${text.slice(0, MAX_CELL_LENGTH)}…`;
  if (FORMULA_START.test(text) && !NUMBER_LIKE.test(text)) return `'${text}`;
  return text;
}

/** Дата `YYYY-MM-DD` як опівніч UTC: Excel покаже саме цей день без зсуву часового поясу. */
export function isoDateToExcel(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

const KYIV_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Момент часу як «настінний» київський час, записаний у UTC: Excel покаже київський годинник. */
export function instantToKyivExcel(value: string | Date): Date | null {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts: Record<string, number> = {};
  for (const part of KYIV_PARTS.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!));
}

type Cell = string | number | boolean | Date | null | { [key: string]: unknown };

function toCell(kind: ExportKind, raw: ReturnType<ExportColumn<unknown>["value"]>): Cell {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (kind) {
    case "date": {
      const date = raw instanceof Date ? raw : isoDateToExcel(String(raw));
      return date ? { type: Date, value: date, format: DATE_FORMAT } : safeText(String(raw));
    }
    case "datetime": {
      const date = instantToKyivExcel(raw instanceof Date ? raw : String(raw));
      return date ? { type: Date, value: date, format: DATETIME_FORMAT } : safeText(String(raw));
    }
    case "money": {
      const value = Number(raw);
      return Number.isFinite(value)
        ? { type: Number, value, format: MONEY_FORMAT }
        : safeText(String(raw));
    }
    case "number": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : safeText(String(raw));
    }
    case "bool":
      return raw === true || raw === "true" ? "Так" : "Ні";
    default:
      // Текст і телефон: завжди рядок (початковий 0 і «+» не губляться).
      return safeText(String(raw));
  }
}

/** Назва аркуша: без символів, яких Excel не дозволяє, до 31 символу, без повторів. */
export function sheetName(raw: string, taken: Set<string>): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SHEET_NAME) || "Аркуш";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    const suffix = ` ${i}`;
    name = `${base.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

function cellLength(cell: Cell): number {
  if (cell === null) return 0;
  if (typeof cell === "string") return cell.length;
  if (typeof cell === "number") return String(cell).length;
  if (typeof cell === "boolean") return 3;
  return 0;
}

/**
 * Порядок елементів аркуша з `ignoredErrors`: бібліотека його не знає, а за специфікацією ECMA-376
 * він стоїть після розривів сторінок (`colBreaks`) і перед малюнками (`drawing`).
 */
function sheetElementOrder(): string[] {
  const order = getOrderOfSiblings("xl/worksheets/sheet{id}.xml", "worksheet");
  // Без відомого порядку елементів Excel може вважати файл пошкодженим, тож краще впасти.
  if (!order) throw new Error("write-excel-file: невідомий порядок елементів аркуша.");
  if (order.includes("ignoredErrors")) return order;
  const after = order.indexOf("colBreaks");
  const before = order.indexOf("drawing");
  const at = after >= 0 ? after + 1 : before;
  if (at < 0) throw new Error("write-excel-file: не знайдено місця для ignoredErrors.");
  return [...order.slice(0, at), "ignoredErrors", ...order.slice(at)];
}

type SheetExtras = { autoFilterRef?: string; ignoredErrorsRef?: string };

/**
 * Доповнення до бібліотеки (вона не вміє ні того, ні того):
 *  - автофільтр на заголовку й усіх рядках даних;
 *  - `ignoredErrors`: Excel не позначає зеленим трикутником «число збережене як текст» (телефони,
 *    коди, ЄДРПОУ лежать текстом навмисно, щоб не губити початковий 0 і «+»).
 */
const sheetExtras = {
  files: {
    transform: {
      "xl/worksheets/sheet{id}.xml": {
        transform(xml: string, sheetOptions: SheetExtras) {
          let result = xml;
          if (sheetOptions.autoFilterRef) {
            result = insertElementMarkupAccordingToOrderOfSiblings(
              result,
              getSelfClosingTagMarkup("autoFilter", { ref: sheetOptions.autoFilterRef }),
              sheetElementOrder(),
              "worksheet",
            );
          }
          if (sheetOptions.ignoredErrorsRef) {
            const ignored =
              getOpeningTagMarkup("ignoredErrors") +
              getSelfClosingTagMarkup("ignoredError", {
                sqref: sheetOptions.ignoredErrorsRef,
                numberStoredAsText: 1,
              }) +
              getClosingTagMarkup("ignoredErrors");
            result = insertElementMarkupAccordingToOrderOfSiblings(
              result,
              ignored,
              sheetElementOrder(),
              "worksheet",
            );
          }
          return result;
        },
      },
    },
  },
};

/** Файл XLSX з аркушів. Порожній аркуш має лише рядок заголовків. */
export async function buildWorkbook(sheets: ExportSheet<unknown>[]): Promise<Buffer> {
  const taken = new Set<string>();
  const prepared = sheets.map((sheet) => {
    const body = sheet.rows.map((row) =>
      sheet.columns.map((column) => toCell(column.kind, column.value(row))),
    );
    const widths = sheet.columns.map((column, index) => {
      // Заголовок жирний (ширший за звичайний текст) і має кнопку автофільтра справа, яка закрила б кінець підпису.
      let longest = Math.ceil(column.header.length * HEADER_FACTOR) + FILTER_BUTTON - 2;
      for (const row of body.slice(0, WIDTH_SAMPLE)) {
        longest = Math.max(longest, cellLength(row[index] ?? null));
      }
      const min = column.minWidth ?? MIN_WIDTH[column.kind];
      return { width: Math.min(MAX_WIDTH, Math.max(min, longest + 2)) };
    });
    const header = sheet.columns.map((column) => ({
      value: safeText(column.header),
      fontWeight: "bold" as const,
      backgroundColor: "#E8EEF3",
    }));
    const lastColumn = Math.max(sheet.columns.length - 1, 0);
    return {
      data: [header, ...body] as never,
      sheet: sheetName(sheet.name, taken),
      columns: widths,
      stickyRowsCount: 1,
      // Фільтр охоплює заголовок і всі рядки даних.
      autoFilterRef: `A1:${getCellAddress(body.length, lastColumn)}`,
      // Усі клітинки даних: числа тут справжні числа, а текст, схожий на число, лишаємо текстом.
      ignoredErrorsRef:
        body.length > 0 ? `A2:${getCellAddress(body.length, lastColumn)}` : undefined,
    };
  });
  const result = await writeExcelFile(prepared as never, { features: [sheetExtras as never] });
  return Buffer.from(await result.toBuffer());
}
