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

/** День з адреси (`?date=`): некоректний чи відсутній дає сьогодні. Спільний для виробництва й готівки. */
export function parseDayParam(raw: RawParams, today: string): string {
  const date = first(raw[PRODUCTION_PARAMS.date]);
  return date !== undefined && isIsoDate(date) ? date : today;
}

export function parseProductionParams(raw: RawParams, today: string): ProductionParams {
  return {
    date: parseDayParam(raw, today),
    wall: first(raw[PRODUCTION_PARAMS.mode]) === WALL_MODE_VALUE,
  };
}
