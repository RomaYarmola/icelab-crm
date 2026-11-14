import { BOX_STATUS_LABELS, type BoxStatus } from "@/server/box-rules";
import { LABEL_FORMATS, type LabelFormat } from "@/constants/boxes";

/** Стан реєстру боксів в адресі сторінки: статус, тип, пошук за кодом, скільки показано. */
export const BOX_LIST_PARAMS = { status: "status", type: "type", search: "q", shown: "n" } as const;

export type BoxListFilters = {
  status: BoxStatus | "";
  boxTypeId: string;
  search: string;
  shown: number;
};

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BOX_PAGE_STEP = 30;
export const BOX_MAX_SHOWN = 300;

export function parseBoxListParams(params: RawParams): BoxListFilters {
  const status = first(params[BOX_LIST_PARAMS.status]);
  const type = first(params[BOX_LIST_PARAMS.type]);
  const shown = Number(first(params[BOX_LIST_PARAMS.shown]));
  return {
    status: status in BOX_STATUS_LABELS ? (status as BoxStatus) : "",
    boxTypeId: UUID.test(type) ? type : "",
    search: first(params[BOX_LIST_PARAMS.search]).trim().slice(0, 20),
    shown:
      Number.isInteger(shown) && shown >= BOX_PAGE_STEP
        ? Math.min(shown, BOX_MAX_SHOWN)
        : BOX_PAGE_STEP,
  };
}

export function countActiveBoxFilters(filters: BoxListFilters): number {
  return [filters.status, filters.boxTypeId].filter(Boolean).length;
}

/** Адреса реєстру з поточними фільтрами й новою кількістю показаних. */
export function boxListHref(filters: BoxListFilters, shown: number): string {
  const query = new URLSearchParams();
  if (filters.status) query.set(BOX_LIST_PARAMS.status, filters.status);
  if (filters.boxTypeId) query.set(BOX_LIST_PARAMS.type, filters.boxTypeId);
  if (filters.search) query.set(BOX_LIST_PARAMS.search, filters.search);
  query.set(BOX_LIST_PARAMS.shown, String(shown));
  return `/boxes?${query.toString()}`;
}

export function parseLabelFormat(value: string | null | undefined): LabelFormat {
  return (LABEL_FORMATS as readonly string[]).includes(value ?? "")
    ? (value as LabelFormat)
    : "sheet_3x8";
}
