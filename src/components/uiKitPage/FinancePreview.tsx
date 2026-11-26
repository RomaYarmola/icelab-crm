import type { Co2PageData } from "@/server/finance/co2";
import type { FormAction } from "../clientsPage/clientActions";
import FinancePageContent from "../financePage/FinancePageContent";
import MonthPageContent from "../financePage/MonthPageContent";
import ReportContent from "../financePage/ReportContent";
import { buildReport } from "@/server/finance/month-rules";
import type { MonthPageData } from "@/server/finance/month";

const DATA: Co2PageData = {
  locations: [
    { id: "preview-kyiv", code: "kyiv", name: "Київ" },
    { id: "preview-lviv", code: "lviv", name: "Львів" },
  ],
  location: { id: "preview-kyiv", code: "kyiv", name: "Київ" },
  today: "2026-11-26",
  startedOn: "2026-11-01",
  stockKg: 1240.5,
  stockValue: "37215.00",
  norm: 2.7,
  shortageKg: 135,
  missingNorm: false,
  months: [
    {
      month: "2026-11",
      orders: { iceKg: 2100, co2Kg: 5670, cost: "161595.00" },
      writeoffs: { iceKg: 24, co2Kg: 64.8, cost: "1944.00" },
      shortageKg: 135,
    },
  ],
  receipts: [
    { id: "r2", date: "2026-11-18", kg: 4000, pricePerKg: "30.00", note: "Друга поставка" },
    { id: "r1", date: "2026-11-01", kg: 3000, pricePerKg: "27.00", note: null },
  ],
  adjustments: [{ id: "a1", date: "2026-11-20", kg: -35, note: "Звірили за вагами" }],
  writeoffs: [{ id: "w1", date: "2026-11-21", kg: 8, note: "Залишок за тиждень" }],
  norms: [{ id: "n1", validFrom: "2026-01-01", norm: 2.7 }],
};

const zero = { ice: 0, delivery: 0, boxes: 0, other: 0 };
const noCo2 = { orders: 0, writeoffs: 0, shortageGrams: 0 };

const MONTH: MonthPageData = {
  month: "2026-10",
  currentMonth: "2026-11",
  closedAt: null,
  report: buildReport({
    month: "2026-10",
    usdRate: 42,
    columns: [
      {
        locationId: "preview-kyiv",
        name: "Київ",
        revenue: { ice: 41_250_000, delivery: 1_830_000, boxes: 2_400_000, other: 0 },
        otherIncome: [],
        co2: { orders: 16_159_500, writeoffs: 194_400, shortageGrams: 0 },
        expenses: [
          { label: "Зарплати й премії", kopecks: 9_000_000 },
          { label: "Електроенергія", kopecks: 1_245_000 },
        ],
        commissions: [
          { profileId: "m1", name: "Тестовий менеджер", grams: 2_100_000, rateKopecks: 200 },
        ],
      },
      {
        locationId: "preview-lviv",
        name: "Львів",
        revenue: { ...zero, ice: 12_600_000 },
        otherIncome: [],
        co2: { ...noCo2, orders: 5_100_000 },
        expenses: [],
        commissions: [],
      },
      {
        locationId: null,
        name: "Спільні",
        revenue: zero,
        otherIncome: [],
        co2: noCo2,
        expenses: [{ label: "Бухгалтер", kopecks: 800_000 }],
        commissions: [],
      },
    ],
  }),
  scopes: [
    {
      locationId: "preview-kyiv",
      name: "Київ",
      fields: [
        {
          categoryId: "c1",
          name: "Зарплати й премії",
          kind: "expense",
          amount: null,
          suggestion: "90000.00",
        },
        {
          categoryId: "c2",
          name: "Електроенергія",
          kind: "expense",
          amount: "12450.00",
          suggestion: null,
        },
        { categoryId: "c3", name: "Інші доходи", kind: "income", amount: null, suggestion: null },
      ],
    },
  ],
  managers: [{ profileId: "m1", name: "Тестовий менеджер", rate: "2.00" }],
  categories: [
    { id: "c1", name: "Зарплати й премії", kind: "expense", repeatsMonthly: true, isActive: true },
    { id: "c3", name: "Інші доходи", kind: "income", repeatsMonthly: false, isActive: true },
  ],
};

/** Екран «Фінрезультат → Звіт» з вигаданими даними (лише для `/ui-kit`). */
export function FinanceReportPreview() {
  return <ReportContent data={MONTH} currency="uah" />;
}

/** Екран «Фінрезультат → Місяць» з вигаданими даними (лише для `/ui-kit`). */
export function FinanceMonthPreview({ formAction }: { formAction: FormAction }) {
  return (
    <MonthPageContent
      data={MONTH}
      actions={{
        saveEntries: formAction,
        setUsdRate: formAction,
        setCommissionRate: formAction,
        addCategory: formAction,
        updateCategory: formAction,
        close: formAction,
        reopen: formAction,
      }}
    />
  );
}

/** Екран «Фінрезультат» з вигаданими даними (лише для `/ui-kit`). */
export default function FinancePreview({ formAction }: { formAction: FormAction }) {
  return (
    <FinancePageContent
      data={DATA}
      actions={{
        addReceipt: formAction,
        addWriteoff: formAction,
        setStock: formAction,
        setNorm: formAction,
        deleteReceipt: formAction,
        deleteWriteoff: formAction,
        deleteAdjustment: formAction,
        deleteNorm: formAction,
      }}
    />
  );
}
