import Link from "next/link";
import { PRODUCTION_PATH } from "@/constants/production";
import { addDays } from "@/utils/isoDate";
import { PRODUCTION_PARAMS } from "@/utils/productionParams";
import { dayLabel } from "@/utils/productionView";
import ChevronIcon from "../shared/icons/ChevronIcon";
import Text from "../shared/texts/Text";
import { formatIsoDate } from "@/utils/isoDate";
import { cn } from "@/utils/cn";

interface ProductionDayNavProps {
  date: string;
  today: string;
  /** Адреса екрана: за замовчуванням виробництво, ту саму навігацію використовує й «Готівка». */
  path?: string;
  /** Підпис навігації для екранних читалок. */
  label?: string;
}

const arrowClassName =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-field border border-grey-field bg-grey-light text-navy transition active:scale-[98%] lg:hover:bg-grey-border";

const hrefFor = (path: string, date: string, today: string) =>
  date === today ? path : `${path}?${PRODUCTION_PARAMS.date}=${date}`;

/**
 * День екрана виробництва: стрілки «вчора» і «завтра» і підпис (ТЗ 6.4). За замовчуванням сьогодні;
 * день пишеться в адресу (`?date=`), тож «Назад» повертає до попереднього дня.
 */
export default function ProductionDayNav({
  date,
  today,
  path = PRODUCTION_PATH,
  label: navLabel = "День виробництва",
}: ProductionDayNavProps) {
  const label = dayLabel(date, today);
  return (
    <nav aria-label={navLabel} className="flex items-center justify-between gap-3">
      <Link
        href={hrefFor(path, addDays(date, -1), today)}
        className={arrowClassName}
        aria-label="Попередній день"
      >
        <ChevronIcon className="size-6 rotate-90" />
      </Link>
      <div className="flex min-w-0 flex-col items-center text-center">
        <p className="text-h2 text-navy">{label}</p>
        {label !== formatIsoDate(date) ? <Text variant="muted">{formatIsoDate(date)}</Text> : null}
        {date !== today ? (
          <Link
            href={path}
            className={cn("text-body font-semibold text-blue underline underline-offset-4")}
          >
            До сьогодні
          </Link>
        ) : null}
      </div>
      <Link
        href={hrefFor(path, addDays(date, 1), today)}
        className={arrowClassName}
        aria-label="Наступний день"
      >
        <ChevronIcon className="size-6 -rotate-90" />
      </Link>
    </nav>
  );
}
