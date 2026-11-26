import type { MonthReport, ReportColumn } from "./month-rules";

/**
 * Рядки звіту «Фінансовий результат» (B15, фаза Б4): колонки по містах і «Разом». Ті самі рядки
 * показує екран і кладе в Excel. Чисті функції, суми в копійках (чи в центах для доларів).
 */

export type ReportRowKind = "line" | "subtotal" | "result";

export type ReportRow = {
  key: string;
  label: string;
  kind: ReportRowKind;
  /** За містами, у порядку `cities`. */
  values: number[];
  /** Разом: міста й спільні витрати та доходи. */
  total: number;
};

export type ReportTable = { cities: string[]; rows: ReportRow[] };

type Source = { label: string; amount: (column: ReportColumn) => number };

const sumByLabel = (lines: { label: string; kopecks: number }[], label: string) =>
  lines.filter((line) => line.label === label).reduce((sum, line) => sum + line.kopecks, 0);

const unique = (values: string[]) => [...new Set(values)];

export function buildReportTable(report: MonthReport): ReportTable {
  const cities = report.columns.filter((column) => column.locationId !== null);
  const all = report.columns;

  const income: Source[] = [
    { label: "Лід", amount: (c) => c.revenue.ice },
    { label: "Платна доставка", amount: (c) => c.revenue.delivery },
    { label: "Бокси", amount: (c) => c.revenue.boxes },
    { label: "Інші товари", amount: (c) => c.revenue.other },
    ...unique(all.flatMap((c) => c.otherIncome.map((line) => line.label))).map((label) => ({
      label,
      amount: (c: ReportColumn) => sumByLabel(c.otherIncome, label),
    })),
  ];
  const people = new Map(
    all.flatMap((c) => c.commissions.map((line) => [line.profileId, line.name] as const)),
  );
  const costs: Source[] = [
    { label: "CO2 на замовлення", amount: (c) => c.co2.orders },
    { label: "CO2 на списаний лід", amount: (c) => c.co2.writeoffs },
    ...unique(all.flatMap((c) => c.expenses.map((line) => line.label))).map((label) => ({
      label,
      amount: (c: ReportColumn) => sumByLabel(c.expenses, label),
    })),
    ...[...people].map(([profileId, name]) => ({
      label: `Комісія: ${name}`,
      amount: (c: ReportColumn) =>
        c.commissions
          .filter((line) => line.profileId === profileId)
          .reduce((sum, line) => sum + line.kopecks, 0),
    })),
  ];

  const row = (key: string, kind: ReportRowKind, source: Source): ReportRow => ({
    key,
    kind,
    label: source.label,
    values: cities.map(source.amount),
    total: all.reduce((sum, column) => sum + source.amount(column), 0),
  });
  // Порожні статті не показуємо; підсумки й результат є завжди.
  const lines = (prefix: string, sources: Source[]) =>
    sources
      .map((source, index) => row(`${prefix}-${index}`, "line", source))
      .filter((item) => item.total !== 0 || item.values.some((value) => value !== 0));

  return {
    cities: cities.map((c) => c.name),
    rows: [
      ...lines("income", income),
      row("income", "subtotal", { label: "Разом доходи", amount: (c) => c.income }),
      ...lines("costs", costs),
      row("costs", "subtotal", { label: "Разом витрати", amount: (c) => c.costs }),
      row("result", "result", { label: "Результат", amount: (c) => c.result }),
    ],
  };
}

/** Таблиця в доларах за курсом місяця (копійки стають центами). */
export function toUsdTable(table: ReportTable, usdRate: number): ReportTable {
  const convert = (kopecks: number) => Math.round(kopecks / usdRate);
  return {
    cities: table.cities,
    rows: table.rows.map((row) => ({
      ...row,
      values: row.values.map(convert),
      total: convert(row.total),
    })),
  };
}
