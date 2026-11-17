import type { ShipmentDay } from "@/server/np/shipment-day";
import { INLINE_HINTS, SCREEN_HINTS } from "@/constants/hints";
import ExportButton from "../shared/export/ExportButton";
import ScreenHint from "../shared/hint/ScreenHint";
import EmptyState from "../shared/emptyState/EmptyState";
import ParcelIcon from "../shared/icons/ParcelIcon";
import ProductionDayNav from "../productionPage/ProductionDayNav";
import ShipmentDayList from "./ShipmentDayList";
import type { ShipmentDayActions } from "./shipmentTypes";

interface ShipmentDayContentProps {
  day: ShipmentDay;
  today: string;
  actions: ShipmentDayActions;
  /** Роль вивантажує в Excel (власник, менеджер). */
  canExport?: boolean;
}

/** Екран «ТТН на день» (ТЗ 6.8): навігація по днях і список замовлень Нової Пошти з масовим створенням. */
export default function ShipmentDayContent({
  day,
  today,
  actions,
  canExport = false,
}: ShipmentDayContentProps) {
  return (
    <div className="flex flex-col gap-6">
      <ProductionDayNav date={day.date} today={today} path="/shipments" label="День накладних" />
      <ScreenHint hint={SCREEN_HINTS.shipments} />
      {canExport && day.rows.length > 0 ? (
        <ExportButton
          list="shipments"
          hint={INLINE_HINTS.exportShipments}
          className="w-full lg:w-auto"
        />
      ) : null}
      {day.rows.length === 0 ? (
        <EmptyState
          icon={<ParcelIcon className="size-10" />}
          title="На цей день замовлень Нової Пошти немає"
          description="Тут з'являться підтверджені замовлення зі способом доставки «Нова Пошта»."
        />
      ) : (
        <ShipmentDayList key={day.date} rows={day.rows} actions={actions} />
      )}
    </div>
  );
}
