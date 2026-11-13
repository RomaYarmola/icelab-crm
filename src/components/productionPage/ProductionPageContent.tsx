import { SCREEN_HINTS } from "@/constants/hints";
import { formatIsoDate } from "@/utils/isoDate";
import type { ProductionQueue } from "@/server/production";
import type { ProductionRealtimeConfig } from "@/server/production-signal";
import { dayLabel } from "@/utils/productionView";
import ButtonLink from "../shared/buttons/ButtonLink";
import ScreenHint from "../shared/hint/ScreenHint";
import ProductionBoard from "./ProductionBoard";
import ProductionDayNav from "./ProductionDayNav";
import ProductionSummary from "./ProductionSummary";
import type { ProductionActions } from "./productionTypes";
import { WallModeButton, WallModeExitButton, WallModeRestore } from "./WallModeControls";

interface ProductionPageContentProps {
  queue: ProductionQueue;
  today: string;
  /** Режим «планшет на стіні»: крупно, лише перегляд, на весь екран (D66). */
  wall: boolean;
  /** Цех і старший локації: кнопки «Розпочати» й «Готово». Власник і менеджер лише читають. */
  canWork: boolean;
  /** Старший локації: змінити кг і коментар, повернути в роботу, увімкнути режим «на стіні». */
  canEdit: boolean;
  /** Назва локації для підпису (у режимі «на стіні» шапки застосунку немає). */
  locationLabel: string;
  realtime: ProductionRealtimeConfig | null;
  actions: ProductionActions;
}

/**
 * Екран виробництва (B6, ТЗ 6.4): день, підсумок, черга карток з живим оновленням. У режимі «на
 * стіні» (лише старший локації) екран займає весь простір поверх шапки й меню: великі літери, без
 * кнопок змін, завжди сьогоднішній день. Цін і сум тут немає ні для кого.
 */
export default function ProductionPageContent({
  queue,
  today,
  wall,
  canWork,
  canEdit,
  locationLabel,
  realtime,
  actions,
}: ProductionPageContentProps) {
  const board = (
    <ProductionBoard
      cards={queue.cards}
      date={queue.date}
      generatedAt={queue.generatedAt}
      isToday={queue.date === today}
      wall={wall}
      canWork={canWork}
      canEdit={canEdit}
      showLocation={queue.locationId === null}
      realtime={realtime}
      actions={actions}
    />
  );

  if (wall) {
    return (
      <div className="fixed inset-0 z-45 overflow-y-auto bg-white px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-wall-title text-navy">Виробництво, {locationLabel}</h1>
              <p className="text-lead text-grey-text">
                {dayLabel(queue.date, today)}, {formatIsoDate(queue.date)}
              </p>
            </div>
            <WallModeExitButton />
          </div>
          <ProductionSummary summary={queue.summary} />
          {board}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? <WallModeRestore /> : null}
      <ProductionDayNav date={queue.date} today={today} />
      <ProductionSummary summary={queue.summary} />
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <WallModeButton />
          <ButtonLink href="/more/cash" variant="outline" size="sm">
            Готівка
          </ButtonLink>
        </div>
      ) : null}
      <ScreenHint hint={SCREEN_HINTS.production} access={{ work: canWork, edit: canEdit }} />
      {board}
    </div>
  );
}
