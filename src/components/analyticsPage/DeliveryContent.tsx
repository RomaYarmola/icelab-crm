import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import type { DeliveryAnalytics, DeliveryMethod, DeliverySlice } from "@/server/analytics-sales";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import { money, percent } from "./format";
import MonthBars from "./MonthBars";
import { monthLabel } from "./monthLabel";

const METHODS: DeliveryMethod[] = ["pickup", "our_delivery", "np", "bus", "other"];

/** «Самовивіз: 5 · Нова Пошта: 3»: лише способи, де є замовлення. */
function describeCounts(counts: Record<DeliveryMethod, number>): string {
  return (
    METHODS.filter((method) => counts[method] > 0)
      .map((method) => `${DELIVERY_METHOD_LABELS[method]}: ${counts[method]}`)
      .join(" · ") || "Замовлень немає"
  );
}

function Slice({ title, rows }: { title: string; rows: DeliverySlice[] }) {
  return (
    <Disclosure summary={`${title} · ${rows.length}`}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-0.5">
            <Text className="font-semibold">{row.label}</Text>
            <Text variant="muted">
              З доставкою {row.delivered} з {row.orders} · платна доставка {money(row.paid)}
            </Text>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * Вкладка «Доставки» (D211): замовлення за способом доставки по місяцях і локаціях, сума платної
 * доставки, частка замовлень із доставкою, клієнти й менеджери. Витрат на доставку не рахуємо.
 */
export default function DeliveryContent({ data }: { data: DeliveryAnalytics }) {
  if (data.orders === 0) {
    return <EmptyState title="За цей період замовлень немає" description="Оберіть інші місяці." />;
  }
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="delivery-total" className="flex flex-col gap-3">
        <SectionTitle id="delivery-total">Разом за період</SectionTitle>
        <Card className="flex flex-col gap-1">
          <Text className="font-semibold">
            З доставкою {data.delivered} з {data.orders} замовлень ({percent(data.deliveredShare)})
          </Text>
          <Text>Платна доставка: {money(data.paid)}</Text>
          <Text variant="muted">{describeCounts(data.counts)}</Text>
          {data.ownOnly ? (
            <Text variant="muted">
              Підсумки по всій компанії; клієнти й менеджери нижче лише ваші.
            </Text>
          ) : null}
        </Card>
      </section>

      <MonthBars
        label="Замовлень із доставкою по місяцях"
        points={data.months.map((m) => {
          const value = m.counts.our_delivery + m.counts.np + m.counts.bus;
          return { month: m.month, value, text: String(value) };
        })}
      />

      <section aria-labelledby="delivery-months" className="flex flex-col gap-2">
        <SectionTitle id="delivery-months">За способами</SectionTitle>
        <ul className="flex flex-col gap-2">
          {data.months.map((m) => (
            <li key={m.month} className="flex flex-col gap-0.5">
              <Text className="font-semibold">{monthLabel(m.month)}</Text>
              <Text variant="muted">
                {describeCounts(m.counts)}
                {Number(m.paid) > 0 ? ` · платна доставка ${money(m.paid)}` : ""}
              </Text>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3">
        <Slice title="По локаціях" rows={data.byLocation} />
        <Slice title={data.ownOnly ? "Мої клієнти" : "По клієнтах"} rows={data.byClient} />
        <Slice title={data.ownOnly ? "Мій результат" : "По менеджерах"} rows={data.byManager} />
      </div>
    </div>
  );
}
