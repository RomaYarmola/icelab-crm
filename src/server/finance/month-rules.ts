/**
 * Підсумки місяця фінрезультату (B15, D218, D234, D236, D237). Чисті функції без бази: усі суми в
 * копійках, щоб не накопичувати похибку.
 */

export type ReportLine = { label: string; kopecks: number };

export type Revenue = { ice: number; delivery: number; boxes: number; other: number };

export type CommissionLine = {
  profileId: string;
  name: string;
  grams: number;
  /** `null`: ставку для цього місяця не задано. */
  rateKopecks: number | null;
  kopecks: number;
};

/** Колонка звіту: місто або «Спільні» (витрати без міста). */
export type ReportColumn = {
  locationId: string | null;
  name: string;
  revenue: Revenue;
  otherIncome: ReportLine[];
  co2: { orders: number; writeoffs: number; shortageGrams: number };
  expenses: ReportLine[];
  commissions: CommissionLine[];
  income: number;
  costs: number;
  result: number;
};

export type MonthReport = {
  /** `YYYY-MM`. */
  month: string;
  columns: ReportColumn[];
  total: { income: number; costs: number; result: number };
  /** Курс долара, грн; `null`, якщо не внесено. */
  usdRate: number | null;
};

export type ColumnInput = Omit<ReportColumn, "income" | "costs" | "result" | "commissions"> & {
  commissions: Omit<CommissionLine, "kopecks">[];
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Комісія: кілограми «на продаж» × ставка за кг, з округленням до копійки. */
export const commissionKopecks = (grams: number, rateKopecks: number | null) =>
  rateKopecks === null ? 0 : Math.round((grams * rateKopecks) / 1000);

export function buildColumn(input: ColumnInput): ReportColumn {
  const commissions = input.commissions.map((line) => ({
    ...line,
    kopecks: commissionKopecks(line.grams, line.rateKopecks),
  }));
  const { ice, delivery, boxes, other } = input.revenue;
  const income = ice + delivery + boxes + other + sum(input.otherIncome.map((l) => l.kopecks));
  const costs =
    input.co2.orders +
    input.co2.writeoffs +
    sum(input.expenses.map((l) => l.kopecks)) +
    sum(commissions.map((l) => l.kopecks));
  return { ...input, commissions, income, costs, result: income - costs };
}

export function buildReport(input: {
  month: string;
  columns: ColumnInput[];
  usdRate: number | null;
}): MonthReport {
  const columns = input.columns.map(buildColumn);
  return {
    month: input.month,
    columns,
    usdRate: input.usdRate,
    total: {
      income: sum(columns.map((c) => c.income)),
      costs: sum(columns.map((c) => c.costs)),
      result: sum(columns.map((c) => c.result)),
    },
  };
}
