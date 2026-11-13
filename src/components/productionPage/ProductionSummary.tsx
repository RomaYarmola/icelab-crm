import type { ProductionSummary as Summary } from "@/server/production-rules";
import { pluralUk } from "@/utils/plural";
import { formatKgPlain } from "@/utils/productionView";
import Text from "../shared/texts/Text";

interface ProductionSummaryProps {
  summary: Summary;
}

/**
 * Підсумок дня: скільки кг якого льоду виготовити, скільки з них ще не запаковано і скільки
 * замовлень не розпочато (D63). Це додаток від нас, у ТЗ його немає; грошей тут немає.
 */
export default function ProductionSummary({ summary }: ProductionSummaryProps) {
  if (summary.byIce.length === 0) return null;
  return (
    <section aria-label="Підсумок за типами льоду" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.byIce.map((ice) => (
          <div
            key={ice.iceTypeId ?? "none"}
            className="flex flex-col gap-0.5 rounded-card border border-grey-border bg-grey-light p-4"
          >
            <Text variant="muted">{ice.iceTypeName}</Text>
            <p className="text-kpi text-navy">{formatKgPlain(ice.kgPlanned)} кг</p>
            <Text variant="muted">
              ще не запаковано {formatKgPlain(ice.kgLeft)} кг, {ice.orders}{" "}
              {pluralUk(ice.orders, ["замовлення", "замовлення", "замовлень"])}
            </Text>
          </div>
        ))}
      </div>
      {summary.notStarted > 0 ? (
        <Text variant="muted">Ще не розпочато: {summary.notStarted}</Text>
      ) : null}
    </section>
  );
}
