import type { Analytics, Metrics, SliceRow } from "@/server/analytics";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import AnalyticsFilters from "./AnalyticsFilters";
import MonthBars from "./MonthBars";
import { monthLabel } from "./monthLabel";
import { shiftMonthLabel } from "./trend";

const money = (value: string) => formatMoney(parseDecimal(value));
const kg = (value: number) => `${value.toLocaleString("uk-UA", { maximumFractionDigits: 3 })} кг`;

const summary = (row: Metrics) => `${kg(row.kg)} · ${money(row.uah)} · замовлень ${row.orders}`;

function Slice({ title, rows }: { title: string; rows: SliceRow[] }) {
  return (
    <Disclosure summary={`${title} · ${rows.length}`}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-0.5">
            <Text className="font-semibold">{row.label}</Text>
            <Text variant="muted">{summary(row)}</Text>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * Панель «Аналітика» (ТЗ 6.11, D204–D206): кг і гривні по місяцях, таблиця по клієнтах із динамікою
 * й розрізи за менеджерами, типами льоду, застосуванням і джерелами. Менеджер бачить своїх клієнтів,
 * а загальні підсумки по компанії (позначено підписом).
 */
export default function AnalyticsContent({ data }: { data: Analytics }) {
  const empty = data.totals.orders === 0 && data.clients.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilters key={`${data.from}-${data.to}`} from={data.from} to={data.to} />
      {empty ? (
        <EmptyState title="За цей період замовлень немає" description="Оберіть інші місяці." />
      ) : (
        <>
          <section aria-labelledby="analytics-total" className="flex flex-col gap-3">
            <SectionTitle id="analytics-total">Разом за період</SectionTitle>
            <Card className="flex flex-col gap-1">
              <Text className="font-semibold">{summary(data.totals)}</Text>
              {data.ownOnly ? (
                <Text variant="muted">
                  Підсумки й графіки по всій компанії; клієнти нижче лише ваші.
                </Text>
              ) : null}
            </Card>
          </section>

          <section aria-labelledby="analytics-months" className="flex flex-col gap-4">
            <SectionTitle id="analytics-months">По місяцях</SectionTitle>
            <MonthBars
              label="Кілограми"
              points={data.months.map((m) => ({ month: m.month, value: m.kg, text: kg(m.kg) }))}
            />
            <MonthBars
              label="Гривні"
              points={data.months.map((m) => ({
                month: m.month,
                value: Number(m.uah),
                text: money(m.uah),
              }))}
            />
          </section>

          <section aria-labelledby="analytics-clients" className="flex flex-col gap-3">
            <SectionTitle id="analytics-clients">
              {data.ownOnly ? "Мої клієнти" : "По клієнтах"}
            </SectionTitle>
            {data.clients.length === 0 ? (
              <Text variant="muted">У ваших клієнтів за цей період замовлень немає.</Text>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.clients.map((client) => (
                  <Card as="li" key={client.clientId} className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <SubTitle className="min-w-0 break-words">{client.clientName}</SubTitle>
                      <Tag className="shrink-0">{client.clientCode}</Tag>
                    </div>
                    <Text>{summary(client)}</Text>
                    <Text variant="muted">
                      {monthLabel(data.to)}: {kg(client.lastMonth.kg)},{" "}
                      {money(client.lastMonth.uah)} ·{" "}
                      {shiftMonthLabel(data.to, client.lastMonth, client.previousMonth)}
                    </Text>
                  </Card>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="analytics-slices" className="flex flex-col gap-3">
            <SectionTitle id="analytics-slices">Розрізи</SectionTitle>
            <Slice title={data.ownOnly ? "Мій результат" : "По менеджерах"} rows={data.byManager} />
            <Slice title="По типах льоду" rows={data.byIceType} />
            <Slice title="По застосуванню" rows={data.byApplication} />
            <Slice title="По джерелах" rows={data.bySource} />
          </section>
        </>
      )}
    </div>
  );
}
