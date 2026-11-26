import type { MonthReportData } from "@/server/finance/month";
import { buildReportTable, type ReportRow, toUsdTable } from "@/server/finance/report-rows";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/formatDate";
import { formatKg, formatMoney } from "@/utils/formatNumber";
import ExportButton from "../shared/export/ExportButton";
import Notification from "../shared/notification/Notification";
import TabLinks from "../shared/tabs/TabLinks";
import Text from "../shared/texts/Text";
import FinanceTabs from "./FinanceTabs";
import MonthNav from "./MonthNav";

interface ReportContentProps {
  data: MonthReportData;
  currency: "uah" | "usd";
}

/** Суми в таблиці без копійок, щоб три колонки вміщались на телефоні; точні в Excel. */
const whole = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const cell = (hundredths: number) => (hundredths === 0 ? "—" : whole.format(hundredths / 100));

function Row({ row }: { row: ReportRow }) {
  const strong = row.kind !== "line";
  return (
    <tbody className={cn("border-t border-grey-border", row.kind === "result" && "bg-grey-light")}>
      <tr>
        <th
          scope="rowgroup"
          colSpan={row.values.length + 1}
          className={cn(
            "px-1 pt-2 text-left text-body",
            strong ? "font-bold text-navy" : "font-normal text-grey-text",
          )}
        >
          {row.label}
        </th>
      </tr>
      <tr>
        {[...row.values, row.total].map((value, index) => (
          <td
            key={index}
            className={cn(
              "px-1 pb-2 text-right text-body whitespace-nowrap tabular-nums text-navy",
              (strong || index === row.values.length) && "font-bold",
            )}
          >
            {cell(value)}
          </td>
        ))}
      </tr>
    </tbody>
  );
}

/**
 * Екран «Фінрезультат → Звіт» (B15, фаза Б4): доходи, витрати й результат по містах і разом за
 * місяць, у гривнях чи доларах за курсом місяця, з вивантаженням в Excel.
 */
export default function ReportContent({ data, currency }: ReportContentProps) {
  const { month, report, closedAt } = data;
  const rate = report.usdRate;
  const inUsd = currency === "usd" && rate !== null;
  const uahTable = buildReportTable(report);
  const table = inUsd ? toUsdTable(uahTable, rate) : uahTable;
  const shortage = report.columns.reduce((sum, column) => sum + column.co2.shortageGrams, 0);
  const hasCommon = report.columns.some(
    (column) => column.locationId === null && (column.income !== 0 || column.costs !== 0),
  );

  return (
    <div className="flex flex-col gap-5">
      <FinanceTabs active="report" />
      <MonthNav path="/finance/report" month={month} currentMonth={data.currentMonth} />

      {closedAt ? (
        <Notification variant="success">
          Місяць закрито {formatDateTime(new Date(closedAt))}: цифри зафіксовано.
        </Notification>
      ) : (
        <Notification>Місяць не закрито: цифри змінюються разом із даними.</Notification>
      )}
      {shortage > 0 ? (
        <Notification variant="warning">
          Не вистачило {formatKg(shortage / 1000)} CO2: пораховано за останньою ціною.
        </Notification>
      ) : null}

      <TabLinks
        label="Валюта"
        activeId={inUsd ? "usd" : "uah"}
        items={[
          { id: "uah", label: "Гривні", href: `/finance/report?month=${month}` },
          { id: "usd", label: "Долари", href: `/finance/report?month=${month}&currency=usd` },
        ]}
      />
      <Text variant="muted">
        {rate === null
          ? "Курс долара за цей місяць не внесено (вкладка «Місяць»)."
          : `Курс долара: ${formatMoney(rate)}.`}
      </Text>

      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Фінансовий результат, {inUsd ? "долари" : "гривні"}</caption>
        <thead>
          <tr>
            {[...table.cities, "Разом"].map((name) => (
              <th key={name} scope="col" className="px-1 pb-2 text-right text-body text-navy">
                {name}, {inUsd ? "$" : "₴"}
              </th>
            ))}
          </tr>
        </thead>
        {table.rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </table>
      {hasCommon ? (
        <Text variant="muted">Спільні витрати й доходи є лише в колонці «Разом».</Text>
      ) : null}

      <ExportButton list="finance-report" hint="Той самий звіт за цей місяць, із копійками." />
    </div>
  );
}
