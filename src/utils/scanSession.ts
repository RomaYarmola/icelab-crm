/**
 * Допоміжні функції сканера боксів (B9, D107, D110): чи це повторний скан того самого коду, підпис
 * лічильника «3 з 4», зсув відповіді. Чисті функції без браузера, щоб їх можна було перевірити тестом.
 */

export type ScanMode = "issue" | "return";

export type ScanResultKind = "ok" | "warning" | "error";

export type ScanEntry = {
  id: string;
  code: string;
  result: ScanResultKind;
  message: string;
};

/** Камера бачить один QR десятки разів на секунду: той самий код у цьому вікні не рахуємо знову. */
export const REPEAT_WINDOW_MS = 3000;

export function isRepeatScan(
  last: { code: string; at: number } | null,
  code: string,
  now: number,
): boolean {
  return last !== null && last.code === code && now - last.at < REPEAT_WINDOW_MS;
}

/** «3 з 4»; без потрібної кількості просто число. */
export function counterLabel(issued: number, needed: number): string {
  return needed > 0 ? `${issued} з ${needed}` : String(issued);
}

/** Новий запис угорі, список не довший за ліміт. */
export function pushEntry(entries: ScanEntry[], entry: ScanEntry, limit = 30): ScanEntry[] {
  return [entry, ...entries].slice(0, limit);
}

/** Відповідь API → запис списку. */
export function entryFromOutcome(
  id: string,
  outcome: { code: string; result: ScanResultKind; message: string },
): ScanEntry {
  return { id, code: outcome.code, result: outcome.result, message: outcome.message };
}
