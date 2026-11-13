import type { CashDay } from "@/server/cash";
import EmptyState from "../shared/emptyState/EmptyState";
import ExportButton from "../shared/export/ExportButton";
import BackLink from "../shared/links/BackLink";
import Notification from "../shared/notification/Notification";
import SubTitle from "../shared/titles/SubTitle";
import ProductionDayNav from "../productionPage/ProductionDayNav";
import CashOrderCard from "./CashOrderCard";
import type { CashActions } from "./cashTypes";
import CashSummary from "./CashSummary";

interface CashPageContentProps {
  day: CashDay;
  /** Сьогоднішня дата `YYYY-MM-DD`. */
  today: string;
  /** Власник і старший локації записують готівку. */
  canRecord: boolean;
  /** Сторно лише власник. */
  canReverse: boolean;
  /** Є право на експорт у Excel (власник, менеджер, бухгалтер, D92). */
  canExport: boolean;
  actions: CashActions;
}

/**
 * Екран «Готівка» (B6, ТЗ 6.6): день, підсумок «мало надійти / внесено / різниця» і замовлення з
 * готівковою оплатою зі сумою до сплати, прийнятим і формою «Прийнято готівку». Власник і старший
 * локації записують, власник ще й сторнує помилки, менеджер і бухгалтер дивляться. Старший локації
 * бачить лише свою локацію й лише суми до сплати (D68).
 */
export default function CashPageContent({
  day,
  today,
  canRecord,
  canReverse,
  canExport,
  actions,
}: CashPageContentProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <BackLink href="/more">Профіль</BackLink>
      <ProductionDayNav date={day.date} today={today} path="/more/cash" label="День готівки" />
      <CashSummary summary={day.summary} />
      {canExport ? <ExportButton list="cash" className="w-full lg:w-auto" /> : null}
      {canRecord ? null : (
        <Notification variant="info">
          Готівку записують старший локації й власник. Тут її можна лише переглядати.
        </Notification>
      )}

      <section aria-labelledby="cash-orders" className="flex flex-col gap-3">
        <SubTitle id="cash-orders">Замовлення з готівкою</SubTitle>
        {day.orders.length === 0 ? (
          <EmptyState
            title={
              day.date === today
                ? "На сьогодні замовлень з готівкою немає"
                : "На цей день замовлень з готівкою немає"
            }
            description="Тут з'являються підтверджені замовлення зі способом оплати «Готівка»."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {day.orders.map((order) => (
              <CashOrderCard
                key={order.id}
                order={order}
                canRecord={canRecord}
                canReverse={canReverse}
                showLocation={day.locationId === null}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
