/**
 * Стан списку клієнтів в адресі сторінки (D47): пошук і фільтри живуть у параметрах адреси, тож
 * ними можна поділитись посиланням, а «Назад» повертає до того самого списку. Чисті функції.
 */

/** Назви параметрів адреси. Короткі, щоб посилання лишалось читабельним. */
export const CLIENT_LIST_PARAMS = {
  search: "q",
  status: "status",
  manager: "manager",
  application: "app",
  deleted: "deleted",
} as const;

export type ClientListFilters = {
  search: string;
  statusId: string;
  managerId: string;
  applicationId: string;
  /** Лише власник: показати й видалених клієнтів. */
  includeDeleted: boolean;
};

export const MAX_SEARCH_LENGTH = 100;

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ідентифікатор з адреси: сміття (старе чи зіпсоване посилання) дає порожнє значення, а не помилку. */
const idParam = (value: string | string[] | undefined): string => {
  const id = first(value);
  return UUID_PATTERN.test(id) ? id : "";
};

/** Параметри адреси сторінки (`searchParams`) у фільтри списку. Зайве й сміття відкидається. */
export function parseClientListParams(params: RawParams): ClientListFilters {
  return {
    search: first(params[CLIENT_LIST_PARAMS.search]).trim().slice(0, MAX_SEARCH_LENGTH),
    statusId: idParam(params[CLIENT_LIST_PARAMS.status]),
    managerId: idParam(params[CLIENT_LIST_PARAMS.manager]),
    applicationId: idParam(params[CLIENT_LIST_PARAMS.application]),
    includeDeleted: first(params[CLIENT_LIST_PARAMS.deleted]) === "1",
  };
}

/** Скільки фільтрів увімкнено (пошук не рахуємо: він має власне поле). */
export function countActiveFilters(filters: ClientListFilters): number {
  return [
    filters.statusId,
    filters.managerId,
    filters.applicationId,
    filters.includeDeleted,
  ].filter(Boolean).length;
}

/** Є хоч щось, що звужує список: пошук або фільтр. Від цього залежить текст порожнього стану. */
export function hasActiveSearch(filters: ClientListFilters): boolean {
  return filters.search !== "" || countActiveFilters(filters) > 0;
}
