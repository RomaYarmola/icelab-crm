import type { BoxAnalytics, BoxSlice } from "@/server/analytics-sales";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import { money, percent } from "./format";
import MonthBars from "./MonthBars";

function Slice({ title, rows, open }: { title: string; rows: BoxSlice[]; open?: boolean }) {
  return (
    <Disclosure summary={`${title} · ${rows.length}`} defaultOpen={open}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-0.5">
            <Text className="font-semibold">{row.label}</Text>
            <Text variant="muted">
              {row.count} шт · {money(row.uah)}
            </Text>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * Вкладка «Бокси» (вимога Романа, D211): продаж боксів по місяцях (кількість і сума), типах тари,
 * клієнтах і менеджерах, частка в виручці. Лише продаж, прибутку не рахуємо.
 */
export default function BoxesContent({ data }: { data: BoxAnalytics }) {
  if (data.totals.count === 0) {
    return (
      <EmptyState
        title="За цей період боксів не продавали"
        description="Бокси рахуємо з замовлень, куди їх додали у блоці «Продаж боксів»."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="boxes-total" className="flex flex-col gap-3">
        <SectionTitle id="boxes-total">Разом за період</SectionTitle>
        <Card className="flex flex-col gap-1">
          <Text className="font-semibold">
            {data.totals.count} шт · {money(data.totals.uah)}
          </Text>
          <Text variant="muted">Частка боксів у виручці: {percent(data.revenueShare)}</Text>
          {data.ownOnly ? (
            <Text variant="muted">
              Підсумки по всій компанії; клієнти й менеджери нижче лише ваші.
            </Text>
          ) : null}
        </Card>
      </section>
      <MonthBars
        label="Штук по місяцях"
        points={data.months.map((m) => ({ month: m.month, value: m.count, text: `${m.count} шт` }))}
      />
      <MonthBars
        label="Гривні по місяцях"
        points={data.months.map((m) => ({
          month: m.month,
          value: Number(m.uah),
          text: money(m.uah),
        }))}
      />
      <div className="flex flex-col gap-3">
        <Slice title="По типах тари" rows={data.byType} open />
        <Slice title={data.ownOnly ? "Мої клієнти" : "По клієнтах"} rows={data.byClient} />
        <Slice title={data.ownOnly ? "Мій результат" : "По менеджерах"} rows={data.byManager} />
      </div>
    </div>
  );
}
