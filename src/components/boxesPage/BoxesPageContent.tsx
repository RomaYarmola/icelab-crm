import Link from "next/link";
import { BOX_STATUS_LABELS } from "@/server/box-rules";
import type { BoxListItem } from "@/server/boxes";
import {
  BOX_LIST_PARAMS,
  BOX_PAGE_STEP,
  boxListHref,
  countActiveBoxFilters,
  type BoxListFilters,
} from "@/utils/boxListParams";
import { formatIsoDate } from "@/utils/isoDate";
import BoxIcon from "../shared/icons/BoxIcon";
import ButtonLink from "../shared/buttons/ButtonLink";
import EmptyState from "../shared/emptyState/EmptyState";
import Disclosure from "../shared/disclosure/Disclosure";
import FilterSelect from "../shared/search/FilterSelect";
import SearchField from "../shared/search/SearchField";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";

interface BoxesPageContentProps {
  items: BoxListItem[];
  hasMore: boolean;
  filters: BoxListFilters;
  types: { id: string; name: string }[];
  /** Показувати локацію в рядках (власник бачить усі локації). */
  showLocation: boolean;
}

/**
 * Реєстр боксів (B9, ТЗ 6.7): пошук за кодом, фільтри за статусом і типом, список з кодом, типом,
 * статусом і клієнтом. Показує власник і старший локації. Кнопка «Згенерувати бокси» веде на форму.
 */
export default function BoxesPageContent({
  items,
  hasMore,
  filters,
  types,
  showLocation,
}: BoxesPageContentProps) {
  const active = countActiveBoxFilters(filters);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
        <div className="flex flex-col gap-3 lg:flex-row">
          <ButtonLink href="/boxes/scan" className="w-full lg:w-auto">
            Сканер
          </ButtonLink>
          <ButtonLink href="/boxes/new" variant="outline" className="w-full lg:w-auto">
            Згенерувати бокси
          </ButtonLink>
        </div>
        <div className="flex-1">
          <SearchField label="Пошук боксів" placeholder="Код бокса, наприклад K-0012" />
        </div>
      </div>
      <Disclosure summary={active > 0 ? `Фільтри · ${active}` : "Фільтри"} defaultOpen={active > 0}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FilterSelect
            paramName={BOX_LIST_PARAMS.status}
            label="Статус"
            allLabel="Усі статуси"
            options={Object.entries(BOX_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            paramName={BOX_LIST_PARAMS.type}
            label="Тип бокса"
            allLabel="Усі типи"
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      </Disclosure>

      {items.length === 0 ? (
        <EmptyState
          icon={<BoxIcon />}
          title={filters.search || active > 0 ? "Нічого не знайдено" : "Боксів ще немає"}
          description={
            filters.search || active > 0
              ? "Спробуйте інший код чи приберіть фільтри."
              : "Натисніть «Згенерувати бокси», щоб створити коди й надрукувати наклейки."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((box) => (
            <li key={box.id}>
              <Link
                href={`/boxes/${box.code}`}
                className="flex flex-col gap-1 rounded-card border border-grey-field bg-white p-4 transition lg:hover:bg-grey-light"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-h2 text-navy">{box.code}</span>
                  <Tag>{box.statusLabel}</Tag>
                </div>
                <Text variant="muted">
                  {box.boxTypeName}
                  {showLocation ? ` · ${box.locationName}` : ""}
                </Text>
                {box.clientName ? (
                  <Text>
                    {box.clientName}
                    {box.issuedAt ? `, з ${formatIsoDate(box.issuedAt.slice(0, 10))}` : ""}
                  </Text>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasMore ? (
        <ButtonLink href={boxListHref(filters, filters.shown + BOX_PAGE_STEP)} variant="outline">
          Показати ще
        </ButtonLink>
      ) : null}
    </div>
  );
}
