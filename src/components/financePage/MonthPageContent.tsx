import type { MonthPageData } from "@/server/finance/month";
import { formatDateTime } from "@/utils/formatDate";
import { formatKg, formatMoney } from "@/utils/formatNumber";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import MainLink from "../shared/links/MainLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import FinanceTabs from "./FinanceTabs";
import {
  CategoryForm,
  CommissionForm,
  EntriesForm,
  MonthStateForm,
  NewCategoryForm,
  UsdRateForm,
} from "./MonthForms";
import MonthNav from "./MonthNav";

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

/**
 * Екран «Фінрезультат → Місяць» (B15, D234, D236, D237): підсумок «Разом», суми статей,
 * курс долара, ставки комісійних, статті й закриття місяця.
 */
export default function MonthPageContent({ data, actions }: MonthPageContentProps) {
  const { month, report, closedAt } = data;
  const isFinished = month < data.currentMonth;
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

      <MonthNav path="/finance/month" month={month} currentMonth={data.currentMonth} />

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
            {formatMoney(report.total.result / 100)}
          </Text>
          <Text variant="muted">
            Доходи {formatMoney(report.total.income / 100)}, витрати{" "}
            {formatMoney(report.total.costs / 100)}.
          </Text>
          <MainLink href={`/finance/report?month=${month}`}>Докладний звіт</MainLink>
        </Card>
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
