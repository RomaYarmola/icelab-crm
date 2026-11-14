import type { BoxStockRow } from "@/server/box-debts";
import { INLINE_HINTS } from "@/constants/hints";
import ExportButton from "../shared/export/ExportButton";
import BoxIcon from "../shared/icons/BoxIcon";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import BoxesTabs from "./BoxesTabs";

interface BoxStockContentProps {
  rows: BoxStockRow[];
  showRegistry: boolean;
  showLocation: boolean;
  canExport: boolean;
}

/** «Бокси → Склад» (ТЗ 4.4): по типу й локації скільки на складі, у клієнтів, продано, втрачено. */
export default function BoxStockContent({
  rows,
  showRegistry,
  showLocation,
  canExport,
}: BoxStockContentProps) {
  return (
    <div className="flex flex-col gap-5">
      <BoxesTabs active="stock" showRegistry={showRegistry} />
      {canExport ? (
        <ExportButton
          list="box-stock"
          hint={INLINE_HINTS.exportBoxStock}
          className="w-full lg:w-auto"
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<BoxIcon />}
          title="Боксів ще немає"
          description="Залишки з'являться, коли власник створить бокси в реєстрі."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={`${row.locationId}:${row.boxTypeId}`}
              className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4"
            >
              <span className="text-h2 text-navy">{row.boxTypeName}</span>
              {showLocation ? <Text variant="muted">{row.locationName}</Text> : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Figure label="На складі" value={row.inStock} />
                <Figure label="У клієнтів" value={row.atClient} />
                <Figure label="Продано" value={row.sold} />
                <Figure label="Втрачено" value={row.lost} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-body text-grey-text">{label}</dt>
      <dd className="text-body font-semibold text-navy">{value}</dd>
    </div>
  );
}
