/**
 * Екран виробництва (B6): підписи кнопок, ключі налаштувань пристрою й інтервали оновлення
 * (D64–D66). Налаштування пристрою (звук, вібрація, режим «на стіні») пам'ятає сам браузер
 * (`localStorage`): у профілі за ТЗ для них немає полів, а планшет на стіні це окремий пристрій.
 */

export const PRODUCTION_BUTTON_LABELS = {
  start: "Розпочати",
  done: "Готово",
  back: "Повернути в роботу",
} as const;

export const DEVICE_STORAGE_KEYS = {
  wall: "icelab.production.wall",
  sound: "icelab.production.sound",
  vibration: "icelab.production.vibration",
} as const;

/** Адреса екрана виробництва і параметр режиму «на стіні» (`?mode=wall`). */
export const PRODUCTION_PATH = "/production";
export const WALL_MODE_VALUE = "wall";

export const PRODUCTION_REFRESH = {
  /** Запасне опитування, поки канал живий: сигнал і так повідомляє про зміни. */
  liveIntervalMs: 45_000,
  /** Опитування, коли каналу немає (D64): раз на 15 секунд. */
  fallbackIntervalMs: 15_000,
  /** Кілька сигналів поспіль зливаємо в одне оновлення. */
  signalDebounceMs: 200,
  /** Через скільки після появи картки на екрані її позначаємо побаченою («Нове», D65). */
  seenDelayMs: 1500,
} as const;
