import { WALL_MODE_VALUE } from "@/constants/production";
import { isIsoDate } from "./isoDate";

/**
 * Стан екрана виробництва в адресі сторінки (D63, D66): день (`?date=`) і режим «на стіні»
 * (`?mode=wall`). Некоректні значення відкидаємо: день тоді сьогоднішній, режим звичайний.
 */

export const PRODUCTION_PARAMS = { date: "date", mode: "mode" } as const;

export type ProductionParams = {
  date: string;
  /** Режим «на стіні» запитано в адресі (чи дозволено його ролі, вирішує сервер). */
  wall: boolean;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseProductionParams(raw: RawParams, today: string): ProductionParams {
  const date = first(raw[PRODUCTION_PARAMS.date]);
  return {
    date: date !== undefined && isIsoDate(date) ? date : today,
    wall: first(raw[PRODUCTION_PARAMS.mode]) === WALL_MODE_VALUE,
  };
}
