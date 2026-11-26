import type { MonthPageData } from "@/server/finance/month";
import type { ReportColumn } from "@/server/finance/month-rules";
import { formatDateTime } from "@/utils/formatDate";
import { formatKg, formatMoney, formatPricePerKg } from "@/utils/formatNumber";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import MainLink from "../shared/links/MainLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import FinanceTabs from "./FinanceTabs";
import {
  CategoryForm,
  CommissionForm,
  EntriesForm,
  MonthStateForm,
  NewCategoryForm,
  UsdRateForm,
} from "./MonthForms";
import { monthTitle } from "./monthTitle";

export interface MonthActions {
  saveEntries: FormAction;
  setUsdRate: FormAction;
  setCommissionRate: FormAction;
  addCategory: FormAction;
  updateCategory: FormAction;
  close: FormAction;
  reopen: FormAction;
}

interface MonthPageContentProps {
  data: MonthPageData;
  actions: MonthActions;
}

const uah = (kopecks: number) => formatMoney(kopecks / 100);

/** Сусідній місяць: «2026-01» мінус один це «2025-12». */
const shift = (month: string, by: number) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1))
    .toISOString()
    .slice(0, 7);

function Line({ label, kopecks, strong }: { label: string; kopecks: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-x-3">
      <Text as="span" variant={strong ? "label" : "muted"}>
        {label}
      </Text>
      <Text as="span" variant={strong ? "label" : "muted"} className="whitespace-nowrap">
        {uah(kopecks)}
      </Text>
    </div>
  );
}

/** Рядки одного міста (чи спільних витрат); нульові не показуємо. */
function Column({ column }: { column: ReportColumn }) {
  const rows = [
    { label: "Лід", kopecks: column.revenue.ice },
    { label: "Платна доставка", kopecks: column.revenue.delivery },
    { label: "Бокси", kopecks: column.revenue.boxes },
    { label: "Інші товари", kopecks: column.revenue.other },
    ...column.otherIncome,
  ].filter((row) => row.kopecks !== 0);
  const costs = [
    { label: "CO2 на замовлення", kopecks: column.co2.orders },
    { label: "CO2 на списаний лід", kopecks: column.co2.writeoffs },
    ...column.expenses,
    ...column.commissions.map((line) => ({
      label: `Комісія: ${line.name} (${formatKg(line.grams / 1000)}${
        line.rateKopecks === null ? "" : ` по ${formatPricePerKg(line.rateKopecks / 100)}`
      })`,
      kopecks: line.kopecks,
    })),
  ].filter((row) => row.kopecks !== 0);

  return (
    <Card as="li" className="flex flex-col gap-2">
      <SubTitle>{column.name}</SubTitle>
      <Line label="Доходи" kopecks={column.income} strong />
      {rows.map((row, index) => (
        <Line key={index} label={row.label} kopecks={row.kopecks} />
      ))}
      <Line label="Витрати" kopecks={column.costs} strong />
      {costs.map((row, index) => (
        <Line key={index} label={row.label} kopecks={row.kopecks} />
      ))}
      <Line label="Результат" kopecks={column.result} strong />
    </Card>
  );
}

/**
 * Екран «Фінрезультат → Місяць» (B15, D234, D236, D237): підсумки по містах і разом, суми статей,
 * курс долара, ставки комісійних, статті й закриття місяця.
 */
export default function MonthPageContent({ data, actions }: MonthPageContentProps) {
  const { month, report, closedAt } = data;
  const isFinished = month < data.currentMonth;
  const columns = report.columns.filter(
    (column) => column.locationId !== null || column.income !== 0 || column.costs !== 0,
  );
  const shortage = report.columns.reduce((sum, column) => sum + column.co2.shortageGrams, 0);
  const withoutRate = [
    ...new Set(
      report.columns.flatMap((column) =>
        column.commissions.filter((line) => line.rateKopecks === null).map((line) => line.name),
      ),
    ),
  ];

  return (
    <div className="flex flex-col gap-5">
      <FinanceTabs active="month" />

      <nav aria-label="Місяць" className="flex items-center justify-between gap-3">
        <MainLink href={`/finance/month?month=${shift(month, -1)}`} className="whitespace-nowrap">
          ← Раніше
        </MainLink>
        <Text variant="label">{monthTitle(month)}</Text>
        {isFinished ? (
          <MainLink href={`/finance/month?month=${shift(month, 1)}`}>Пізніше →</MainLink>
        ) : (
          <Text as="span" variant="muted">
            поточний
          </Text>
        )}
      </nav>

      {closedAt ? (
        <Notification variant="success">
          Місяць закрито {formatDateTime(new Date(closedAt))}: цифри зафіксовано.
        </Notification>
      ) : null}
      {!closedAt && shortage > 0 ? (
        <Notification variant="warning">
          Не вистачає {formatKg(shortage / 1000)} CO2: пораховано за останньою ціною.
        </Notification>
      ) : null}
      {!closedAt && withoutRate.length > 0 ? (
        <Notification variant="warning">
          Немає ставки комісійних: {withoutRate.join(", ")}. Комісію не пораховано.
        </Notification>
      ) : null}

      <section aria-labelledby="month-result" className="flex flex-col gap-3">
        <SectionTitle id="month-result">Результат</SectionTitle>
        <Card className="flex flex-col gap-1">
          <Text variant="label">Разом</Text>
          <Text variant="kpi" className="font-extrabold">
            {uah(report.total.result)}
          </Text>
          <Text variant="muted">
            Доходи {uah(report.total.income)}, витрати {uah(report.total.costs)}.
          </Text>
          <Text variant="muted">
            {report.usdRate === null
              ? "Курс долара не внесено."
              : `≈ ${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
                  report.total.result / 100 / report.usdRate,
                )} $ за курсом ${formatMoney(report.usdRate)}.`}
          </Text>
        </Card>
        <ul className="flex flex-col gap-3">
          {columns.map((column) => (
            <Column key={column.locationId ?? "common"} column={column} />
          ))}
        </ul>
      </section>

      {closedAt ? (
        <Disclosure summary="Відкрити місяць">
          <MonthStateForm
            action={actions.reopen}
            month={month}
            label="Відкрити місяць"
            hint="Цифри знову рахуватимуться з поточних даних. Зафіксовані лишаться в журналі змін."
          />
        </Disclosure>
      ) : (
        <>
          <section aria-labelledby="month-input" className="flex flex-col gap-3">
            <SectionTitle id="month-input">Внести за місяць</SectionTitle>
            {data.scopes.map((scope) => (
              <Disclosure key={`${month}:${scope.locationId}`} summary={`Суми: ${scope.name}`}>
                <EntriesForm action={actions.saveEntries} month={month} scope={scope} />
              </Disclosure>
            ))}
            <Disclosure summary="Курс долара">
              <UsdRateForm
                key={month}
                action={actions.setUsdRate}
                month={month}
                rate={report.usdRate}
              />
            </Disclosure>
            <Disclosure summary="Ставки комісійних">
              <div className="flex flex-col gap-5">
                {data.managers.map((manager) => (
                  <CommissionForm
                    key={`${month}:${manager.profileId}`}
                    action={actions.setCommissionRate}
                    month={month}
                    manager={manager}
                  />
                ))}
              </div>
            </Disclosure>
          </section>

          {isFinished ? (
            <Disclosure summary="Закрити місяць">
              <MonthStateForm
                action={actions.close}
                month={month}
                label="Закрити місяць"
                hint="Цифри зафіксуються: пізніші виправлення замовлень, CO2 чи цін їх не змінять."
              />
            </Disclosure>
          ) : null}
        </>
      )}

      <section aria-labelledby="month-categories" className="flex flex-col gap-3">
        <SectionTitle id="month-categories">Статті</SectionTitle>
        <Disclosure summary="Додати статтю">
          <NewCategoryForm action={actions.addCategory} />
        </Disclosure>
        <Disclosure variant="plain" summary={`Усі статті (${data.categories.length})`}>
          <div className="flex flex-col gap-3">
            {data.categories.map((category) => (
              <Disclosure
                key={category.id}
                variant="plain"
                summary={`${category.name}${category.kind === "income" ? " (дохід)" : ""}${
                  category.isActive ? "" : ", вимкнена"
                }`}
              >
                <CategoryForm action={actions.updateCategory} category={category} />
              </Disclosure>
            ))}
          </div>
        </Disclosure>
      </section>
    </div>
  );
}
