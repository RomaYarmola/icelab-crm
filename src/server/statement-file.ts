import { strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";

/**
 * Читання файлу виписки (B13, ТЗ 6.10, 8.5): CSV чи XLSX з програми банку у таблицю рядків, пошук
 * колонок за заголовками, розбір дати й суми. Чисті функції без бази. Дати без пояса вважаємо
 * київськими; суми в гривнях з комою чи крапкою; імпортуємо лише надходження.
 */

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_ROWS = 5000;

export type StatementTable = { headers: string[]; rows: string[][] };

export class StatementFileError extends Error {}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

function detectDelimiter(firstLine: string): string {
  const counts = [";", "\t", ","].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ",";
}

/** CSV за RFC 4180: лапки, подвоєні лапки, переноси всередині клітинки, роздільник `;`, `,` чи табуляція. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(source.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

const attr = (source: string, name: string) =>
  new RegExp(`${name}="([^"]*)"`).exec(source)?.[1] ?? null;

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const columnIndex = (ref: string): number =>
  [...ref.replace(/\d+/g, "")].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const DATE_FORMAT = /[dmyhs]/i;
const BUILT_IN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Серійне число Excel у «рррр-мм-дд гг:хх:сс» (без пояса: так його й показує Excel). */
export function excelSerialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Перший аркуш XLSX як таблиця рядків; дати з клітинок із форматом дати стають текстом. */
export function parseXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new StatementFileError(
      "Не вдалося відкрити файл Excel. Збережіть виписку як .xlsx чи .csv.",
    );
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]!) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescapeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const styles = text("xl/styles.xml");
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s+([^>]*?)\/>/g)) {
    custom.set(Number(attr(m[1]!, "numFmtId")), unescapeXml(attr(m[1]!, "formatCode") ?? ""));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const isDateStyle = [...cellXfs.matchAll(/<xf\s+([^>]*?)\/?>/g)].map((m) => {
    const id = Number(attr(m[1]!, "numFmtId") ?? 0);
    const code = custom.get(id);
    return code !== undefined
      ? DATE_FORMAT.test(code.replace(/"[^"]*"/g, ""))
      : BUILT_IN_DATE_IDS.has(id);
  });

  // Перший аркуш за зв'язками книги; запасний шлях `sheet1.xml`.
  const rel = /<sheet\b[^>]*r:id="([^"]+)"/.exec(text("xl/workbook.xml"))?.[1];
  const target = rel
    ? (new RegExp(`<Relationship\\b[^>]*Id="${rel}"[^>]*Target="([^"]+)"`).exec(
        text("xl/_rels/workbook.xml.rels"),
      )?.[1] ??
      new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rel}"`).exec(
        text("xl/_rels/workbook.xml.rels"),
      )?.[1])
    : undefined;
  const path = target ? `xl/${target.replace(/^\/?(xl\/)?/, "")}` : "xl/worksheets/sheet1.xml";
  const xml = text(path) || text("xl/worksheets/sheet1.xml");
  if (!xml) throw new StatementFileError("У файлі Excel немає даних.");

  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of rowMatch[1]!.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const index = columnIndex(attr(c[1]!, "r") ?? "A1");
      const body = c[2] ?? "";
      const type = attr(c[1]!, "t");
      let value = "";
      if (type === "s") value = shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])] ?? "";
      else if (type === "inlineStr") {
        value = unescapeXml(
          [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""),
        );
      } else {
        const raw = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "";
        const styleIndex = attr(c[1]!, "s");
        value =
          raw !== "" && styleIndex !== null && isDateStyle[Number(styleIndex)]
            ? excelSerialToText(Number(raw))
            : unescapeXml(raw);
      }
      cells[index] = value;
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""));
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Файл виписки в таблицю: перший рядок заголовки. Формат за розширенням чи початком файлу. */
export function readStatementFile(name: string, bytes: Uint8Array): StatementTable {
  if (bytes.byteLength === 0) throw new StatementFileError("Файл порожній.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new StatementFileError("Файл завеликий: до 3 МБ. Завантажте виписку за коротший період.");
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xls$/i.test(name) && !isZip) {
    throw new StatementFileError("Старий формат .xls не підтримуємо: збережіть як .xlsx чи .csv.");
  }
  const all = isZip ? parseXlsx(bytes) : parseCsv(new TextDecoder("utf-8").decode(bytes));
  if (all.length < 2) throw new StatementFileError("У файлі немає рядків із платежами.");
  const headers = all[0]!.map((h) => h.trim());
  const rows = all.slice(1);
  if (rows.length > MAX_ROWS) {
    throw new StatementFileError(`У файлі понад ${MAX_ROWS} рядків. Завантажте виписку частинами.`);
  }
  return { headers, rows };
}

// ---------------------------------------------------------------------------------------------
// Колонки
// ---------------------------------------------------------------------------------------------

export type ColumnMapping = {
  date: string | null;
  amount: string | null;
  description: string | null;
  counter: string | null;
  comment: string | null;
};

export const MAPPING_FIELDS = ["date", "amount", "description", "counter", "comment"] as const;

const norm = (value: string) => value.toLowerCase().replace(/[іi]/g, "и").replace(/\s+/g, " ");

function pick(headers: readonly string[], rules: RegExp[]): string | null {
  for (const rule of rules) {
    const found = headers.find((header) => rule.test(norm(header)));
    if (found) return found;
  }
  return null;
}

/** Пропозиція колонок за заголовками (укр., рос., англ.). Користувач може змінити будь-яку. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  return {
    date: pick(headers, [/дата.*час/, /дата/, /date/, /час/, /время/]),
    amount: pick(headers, [
      /сума.*картки/,
      /^сума$/,
      /надходжен|приход|кредит|credit/,
      /^(?!.*(коміс|кешбек|залишок|курс|валют)).*(сума|amount|сумма)/,
    ]),
    description: pick(headers, [
      /деталі|детали/,
      /опис|описание|description|details/,
      /призначення|назначение/,
    ]),
    counter: pick(headers, [
      /контрагент|counterpart/,
      /платник|плательщик|відправник|отправитель|sender/,
    ]),
    comment: pick(headers, [
      /коментар|комментарий|comment|примітка|призначення платежу|назначение платежа/,
    ]),
  };
}

/** Чи всі колонки шаблону є в заголовках файлу (тоді шаблон можна застосувати). */
export function mappingFits(mapping: ColumnMapping, headers: readonly string[]): boolean {
  return (
    Boolean(mapping.date && mapping.amount) &&
    MAPPING_FIELDS.every((field) => mapping[field] === null || headers.includes(mapping[field]!))
  );
}

// ---------------------------------------------------------------------------------------------
// Значення
// ---------------------------------------------------------------------------------------------

function kyivOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Київський місцевий час у момент часу (враховує літній час). */
export function kyivLocalToDate(y: number, m: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let result = guess - kyivOffsetMinutes(new Date(guess)) * 60_000;
  result = guess - kyivOffsetMinutes(new Date(result)) * 60_000;
  return new Date(result);
}

/**
 * Дата й час із клітинки: «23.11.2026 14:05(:09)», «2026-11-23 14:05», «2026-11-23T11:05:00Z»,
 * «23/11/2026». Без пояса вважаємо київським часом. Некоректне дає `null`.
 */
export function parseStatementDate(value: string): Date | null {
  const text = value.trim();
  if (text === "") return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  let match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    text,
  );
  let parts: number[] | null = null;
  if (match)
    parts = [
      Number(match[3]),
      Number(match[2]),
      Number(match[1]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
    ];
  else {
    match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (match)
      parts = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      ];
  }
  if (!parts) return null;
  const [y, m, d, h, mi, s] = parts as [number, number, number, number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return kyivLocalToDate(y, m, d, h, mi, s);
}

/** Сума в копійках з клітинки: «2 250,50», «2250.5», «-100», «2 250 ₴». Некоректне дає `null`. */
export function parseStatementAmount(value: string): number | null {
  let text = value.replace(/[\s  ]/g, "").replace(/(грн\.?|uah|₴)/gi, "");
  if (text === "" || !/^[+-]?[\d.,]+$/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);
  if (decimalAt >= 0 && text.length - decimalAt - 1 <= 2 && text.length - decimalAt - 1 >= 1) {
    text = text.slice(0, decimalAt).replace(/[.,]/g, "") + "." + text.slice(decimalAt + 1);
  } else {
    text = text.replace(/[.,]/g, "");
  }
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export type ImportRow = {
  /** Номер рядка у файлі (з урахуванням заголовка). */
  line: number;
  occurredAt: Date;
  amountKopecks: number;
  description: string | null;
  counterName: string | null;
  comment: string | null;
  /** Відбиток для захисту від дублів: дата, сума, опис і порядковий номер однакових рядків. */
  hash: string;
};

export type ParsedStatement = {
  rows: ImportRow[];
  /** Витрати й нульові суми: не імпортуємо. */
  skippedOutgoing: number;
  errors: { line: number; message: string }[];
};

const clean = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/** Відбиток рядка (D: дата, сума, опис). Однакові рядки в одному файлі різняться порядковим номером. */
export function rowHash(
  occurredAt: Date,
  amountKopecks: number,
  description: string | null,
  occurrence: number,
): string {
  return createHash("sha256")
    .update(
      `${occurredAt.toISOString()}|${amountKopecks}|${(description ?? "").toLowerCase().trim()}|${occurrence}`,
    )
    .digest("hex");
}

/** Застосовує зіставлення колонок до таблиці: надходження з перевіреними датою й сумою. */
export function applyMapping(table: StatementTable, mapping: ColumnMapping): ParsedStatement {
  if (!mapping.date || !mapping.amount) {
    throw new StatementFileError("Вкажіть колонки «Дата» й «Сума».");
  }
  const index = (name: string | null) => (name ? table.headers.indexOf(name) : -1);
  const iDate = index(mapping.date);
  const iAmount = index(mapping.amount);
  if (iDate < 0 || iAmount < 0) throw new StatementFileError("Вибраних колонок немає у файлі.");
  const iDescription = index(mapping.description);
  const iCounter = index(mapping.counter);
  const iComment = index(mapping.comment);

  const result: ParsedStatement = { rows: [], skippedOutgoing: 0, errors: [] };
  const seen = new Map<string, number>();
  table.rows.forEach((cells, offset) => {
    const line = offset + 2;
    const occurredAt = parseStatementDate(cells[iDate] ?? "");
    const amountKopecks = parseStatementAmount(cells[iAmount] ?? "");
    if (!occurredAt)
      return void result.errors.push({ line, message: "Не вдалося прочитати дату." });
    if (amountKopecks === null)
      return void result.errors.push({ line, message: "Не вдалося прочитати суму." });
    if (amountKopecks <= 0) {
      result.skippedOutgoing += 1;
      return;
    }
    const description = clean(cells[iDescription]);
    let counterName = iCounter >= 0 ? clean(cells[iCounter]) : null;
    // У виписці monobank платник іде в описі: «Від: Кафе Тест».
    if (!counterName && description) {
      const from = /^від\s*:\s*(.+)$/i.exec(description.split(/\r?\n/)[0] ?? "");
      if (from) counterName = from[1]!.trim();
    }
    const base = `${occurredAt.toISOString()}|${amountKopecks}|${(description ?? "").toLowerCase().trim()}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    result.rows.push({
      line,
      occurredAt,
      amountKopecks,
      description,
      counterName,
      comment: iComment >= 0 ? clean(cells[iComment]) : null,
      hash: rowHash(occurredAt, amountKopecks, description, occurrence),
    });
  });
  return result;
}
