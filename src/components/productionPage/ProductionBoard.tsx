"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRODUCTION_REFRESH } from "@/constants/production";
import type { ProductionCard as ProductionCardData } from "@/server/production";
import type { ProductionRealtimeConfig } from "@/server/production-signal";
import { formatClock } from "@/utils/productionView";
import MainButton from "../shared/buttons/MainButton";
import EmptyState from "../shared/emptyState/EmptyState";
import RefreshIcon from "../shared/icons/RefreshIcon";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import { playAlertSound, vibrateAlert } from "./alerts";
import { useDeviceFlag, writeDeviceFlag } from "./deviceSettings";
import DeviceToggles from "./DeviceToggles";
import MarkAllSeenForm from "./MarkAllSeenForm";
import ProductionCard from "./ProductionCard";
import type { ProductionActions } from "./productionTypes";
import { useProductionLive } from "./useProductionLive";
import { useWakeLock } from "./useWakeLock";

interface ProductionBoardProps {
  cards: ProductionCardData[];
  date: string;
  /** Коли сервер зібрав ці дані (ISO): «Оновлено о 14:05». */
  generatedAt: string;
  /** Чи це сьогоднішній день (для порожнього стану). */
  isToday: boolean;
  /** Режим «планшет на стіні»: крупно, лише перегляд, екран не гасне. */
  wall: boolean;
  canWork: boolean;
  canEdit: boolean;
  /** Показувати локацію на картках: коли черга охоплює кілька локацій. */
  showLocation: boolean;
  realtime: ProductionRealtimeConfig | null;
  actions: ProductionActions;
}

/**
 * Черга цеху з живим оновленням (D63–D66). Відповідає за те, що відбувається на самому екрані:
 * оновлення за сигналом із запасним опитуванням, підсвічування «Нове» (воно лишається, поки екран
 * відкритий, хоч сервер уже вважає замовлення побаченим), звук і вібрація при новому замовленні,
 * автозапуск і «побачене» після першого показу, екран що не гасне в режимі «на стіні».
 */
export default function ProductionBoard({
  cards,
  date,
  generatedAt,
  isToday,
  wall,
  canWork,
  canEdit,
  showLocation,
  realtime,
  actions,
}: ProductionBoardProps) {
  const router = useRouter();
  const { status, refresh } = useProductionLive(realtime);
  const [sound] = useDeviceFlag("sound");
  const [vibration] = useDeviceFlag("vibration");
  const wake = useWakeLock(wall);

  // Підсвічені «нові»: усе, що було новим при будь-якому показі, поки екран відкритий.
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(
    () => new Set(cards.filter((card) => card.isNew).map((card) => card.id)),
  );
  const [shownCards, setShownCards] = useState(cards);
  if (cards !== shownCards) {
    setShownCards(cards);
    const current = new Set(cards.map((card) => card.id));
    const next = new Set([...highlighted].filter((id) => current.has(id)));
    for (const card of cards) if (card.isNew) next.add(card.id);
    setHighlighted(next);
  }

  // Звук і вібрація, коли під час роботи екрана з'явилось нове замовлення (не при першому показі).
  const known = useRef<{ date: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(cards.map((card) => card.id));
    const previous = known.current;
    known.current = { date, ids };
    if (!previous || previous.date !== date) return;
    if (cards.some((card) => card.isNew && !previous.ids.has(card.id))) {
      if (sound) playAlertSound();
      if (vibration) vibrateAlert();
    }
  }, [cards, date, sound, vibration]);

  // Після показу екрана: автозапуск на сьогодні (D72) і «нові» стають побаченими (D65).
  const reported = useRef(new Set<string>());
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!canWork) return;
    const pending = cards
      .filter((card) => card.isNew && !reported.current.has(card.id))
      .map((card) => card.id);
    if (pending.length === 0 && openedFor.current === date) return;
    const timer = setTimeout(() => {
      openedFor.current = date;
      for (const id of pending) reported.current.add(id);
      void actions.openScreen({ date, seenOrderIds: pending }).then((result) => {
        if (result.status === "ok" && result.started > 0) router.refresh();
      });
    }, PRODUCTION_REFRESH.seenDelayMs);
    return () => clearTimeout(timer);
  }, [cards, date, canWork, actions, router]);

  // Режим «на стіні» пам'ятає пристрій: після перезапуску планшет відкриє його знову.
  useEffect(() => {
    if (wall) writeDeviceFlag("wall", true);
  }, [wall]);

  const newCount = cards.filter((card) => card.isNew || highlighted.has(card.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {realtime && status === "down" ? (
        <Notification variant="warning" title="Офлайн: показано збережене">
          Живе оновлення тимчасово не працює, екран оновлюється кожні 15 секунд.
        </Notification>
      ) : null}
      {wall && !wake.supported ? (
        <Notification variant="info">
          Цей браузер не вміє тримати екран увімкненим. Вимкніть автоблокування екрана в
          налаштуваннях планшета.
        </Notification>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Text variant="lead" className="font-semibold">
          нових: {newCount}
        </Text>
        <div className="flex items-center gap-3">
          <Text variant="muted">Оновлено о {formatClock(generatedAt)}</Text>
          <MainButton
            variant="ghost"
            size="sm"
            fullWidth={false}
            icon={<RefreshIcon className="size-5" />}
            onClick={refresh}
          >
            Оновити
          </MainButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DeviceToggles />
        {canWork && !wall && newCount > 0 ? (
          <MarkAllSeenForm date={date} action={actions.markAllSeen} />
        ) : null}
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title={isToday ? "На сьогодні замовлень немає" : "На цей день замовлень немає"}
        />
      ) : (
        <ul
          className={
            wall
              ? "grid gap-4 lg:grid-cols-2 2xl:grid-cols-3"
              : "flex flex-col gap-3 lg:grid lg:grid-cols-2"
          }
        >
          {cards.map((card) => (
            <ProductionCard
              key={card.id}
              card={card}
              highlighted={card.isNew || highlighted.has(card.id)}
              wall={wall}
              canWork={canWork}
              canEdit={canEdit}
              showLocation={showLocation}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
