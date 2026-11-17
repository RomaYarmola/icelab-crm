import type { ShipmentDay } from "@/server/np/shipment-day";
import EmptyState from "../shared/emptyState/EmptyState";
import ParcelIcon from "../shared/icons/ParcelIcon";
import ProductionDayNav from "../productionPage/ProductionDayNav";
import ShipmentDayList from "./ShipmentDayList";
import type { ShipmentDayActions } from "./shipmentTypes";

interface ShipmentDayContentProps {
  day: ShipmentDay;
  today: string;
  actions: ShipmentDayActions;
}

/** Екран «ТТН на день» (ТЗ 6.8): навігація по днях і список замовлень Нової Пошти з масовим створенням. */
export default function ShipmentDayContent({ day, today, actions }: ShipmentDayContentProps) {
  return (
    <div className="flex flex-col gap-6">
      <ProductionDayNav date={day.date} today={today} path="/shipments" label="День накладних" />
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
