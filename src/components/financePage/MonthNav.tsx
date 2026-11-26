import { shiftMonth } from "@/utils/month";
import MainLink from "../shared/links/MainLink";
import Text from "../shared/texts/Text";
import { monthTitle } from "./monthTitle";

interface MonthNavProps {
  /** Адреса сторінки без параметрів. */
  path: string;
  month: string;
  currentMonth: string;
}

/** Перехід між місяцями: назад завжди, вперед лише до поточного. */
export default function MonthNav({ path, month, currentMonth }: MonthNavProps) {
  return (
    <nav aria-label="Місяць" className="flex items-center justify-between gap-3">
      <MainLink href={`${path}?month=${shiftMonth(month, -1)}`} className="whitespace-nowrap">
        ← Раніше
      </MainLink>
      <Text variant="label">{monthTitle(month)}</Text>
      {month < currentMonth ? (
        <MainLink href={`${path}?month=${shiftMonth(month, 1)}`} className="whitespace-nowrap">
          Пізніше →
        </MainLink>
      ) : (
        <Text as="span" variant="muted">
          поточний
        </Text>
      )}
    </nav>
  );
}
