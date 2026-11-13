import { strFromU8, unzipSync } from "fflate";

/**
 * Мінімальний читач XLSX для тестів експорту: розпаковує файл і розбирає аркуші, рядки, стилі.
 * Бібліотека вміє лише писати, тож перевіряємо те, що справді лежить у файлі (XML), а не те, що
 * ми передали на вхід.
 */

export type ReadCell = {
  /** `s` рядок, `n` число, `f` формула. */
  type: "s" | "n" | "f";
  value: string | number;
  /** Код формату числа (для дат), якщо клітинка має стиль. */
  format: string | null;
};

export type ReadSheet = {
  name: string;
  /** Рядки з клітинками за адресою колонки (`A`, `B`…); порожні клітинки відсутні. */
  rows: Record<string, ReadCell>[];
  /** Адреса автофільтра (`A1:E3`), якщо є. */
  autoFilter: string | null;
  /** Діапазон, де Excel не показує «число збережене як текст», якщо задано. */
  ignoredErrors: string | null;
  /** Кількість заморожених рядків. */
  frozenRows: number;
  /** Ширини колонок за порядком. */
  widths: number[];
  xml: string;
};

const BUILT_IN_FORMATS: Record<number, string> = {
  0: "General",
  14: "m/d/yyyy",
  22: "m/d/yyyy h:mm",
};

function attr(source: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(source);
  return match ? match[1]! : null;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function readXlsx(buffer: Uint8Array): { sheets: ReadSheet[]; files: string[] } {
  const files = unzipSync(buffer);
  const text = (path: string) => (files[path] ? strFromU8(files[path]!) : "");

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescapeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );

  // Формати чисел: вбудовані й власні, і з'єднання «номер стилю → код формату».
  const styles = text("xl/styles.xml");
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s+([^>]*?)\/>/g)) {
    custom.set(Number(attr(m[1]!, "numFmtId")), unescapeXml(attr(m[1]!, "formatCode") ?? ""));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const styleFormats = [...cellXfs.matchAll(/<xf\s+([^>]*?)\/?>/g)].map((m) => {
    const id = Number(attr(m[1]!, "numFmtId") ?? 0);
    return custom.get(id) ?? BUILT_IN_FORMATS[id] ?? `#${id}`;
  });

  const workbook = text("xl/workbook.xml");
  const sheetNames = [...workbook.matchAll(/<sheet\s+([^>]*?)\/>/g)].map((m) =>
    unescapeXml(attr(m[1]!, "name") ?? ""),
  );

  const sheets = sheetNames.map((name, index): ReadSheet => {
    const xml = text(`xl/worksheets/sheet${index + 1}.xml`);
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells: Record<string, ReadCell> = {};
      for (const c of row[1]!.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1]!, "r")!;
        const column = ref.replace(/\d+/g, "");
        const body = c[2] ?? "";
        const styleIndex = attr(c[1]!, "s");
        const format = styleIndex === null ? null : (styleFormats[Number(styleIndex)] ?? null);
        if (/<f[\s>]/.test(body)) {
          cells[column] = { type: "f", value: body, format };
        } else if (attr(c[1]!, "t") === "s") {
          cells[column] = {
            type: "s",
            value: shared[Number(/<v>(\d+)<\/v>/.exec(body)![1])]!,
            format,
          };
        } else {
          const value = /<v>([^<]*)<\/v>/.exec(body);
          if (value) cells[column] = { type: "n", value: Number(value[1]), format };
        }
      }
      return cells;
    });
    const pane = /<pane\b([^>]*)\/>/.exec(xml);
    return {
      name,
      rows,
      autoFilter: attr(/<autoFilter\b([^>]*)\/>/.exec(xml)?.[1] ?? "", "ref"),
      ignoredErrors: attr(/<ignoredError\b([^>]*)\/>/.exec(xml)?.[1] ?? "", "sqref"),
      frozenRows: pane ? Number(attr(pane[1]!, "ySplit") ?? 0) : 0,
      widths: [...xml.matchAll(/<col\b([^>]*)\/>/g)].map((m) => Number(attr(m[1]!, "width"))),
      xml,
    };
  });
  return { sheets, files: Object.keys(files) };
}

/** Значення клітинок аркуша як звичайні масиви (для зручних `toEqual`). */
export function sheetValues(sheet: ReadSheet, columns: string[]): (string | number | null)[][] {
  return sheet.rows.map((row) => columns.map((column) => row[column]?.value ?? null));
}

/** Excel зберігає дату як число днів від 30.12.1899. */
export function excelSerial(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const days = Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
  return days + (hour * 60 + minute) / 1_440;
}
