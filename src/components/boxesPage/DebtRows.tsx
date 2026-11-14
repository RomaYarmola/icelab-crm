import Link from "next/link";
import type { BoxDebtRow } from "@/server/box-debts";
import { boxWord, debtReminderText } from "@/utils/boxDebtText";
import { formatIsoDate } from "@/utils/isoDate";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import CopyTextButton from "./CopyTextButton";

interface DebtRowsProps {
  rows: BoxDebtRow[];
  /** Показувати клієнта (на картці клієнта він відомий, тож там не потрібен). */
  showClient?: boolean;
}

/** Рядки боргів: тип, кількість, найдавніший день, скільки днів, «Нагадати» копіює текст. */
export default function DebtRows({ rows, showClient = true }: DebtRowsProps) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={`${row.clientId}:${row.boxTypeId}`}
          className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {showClient ? (
                <Link
                  href={`/clients/${row.clientId}?tab=boxes`}
                  className="text-h2 break-words text-navy underline-offset-2 lg:hover:underline"
                >
                  {row.clientName}
                </Link>
              ) : (
                <span className="text-h2 text-navy">{row.boxTypeName}</span>
              )}
              <Text variant="muted">
                {showClient ? `${row.boxTypeName} · ` : ""}
                {row.total} {boxWord(row.total)}
              </Text>
            </div>
            {row.legacyCount > 0 ? <Tag>за таблицею: {row.legacyCount}</Tag> : null}
          </div>
          {row.oldestDay ? (
            <Text>
              З {formatIsoDate(row.oldestDay)}
              {row.days !== null ? `, ${row.days} дн.` : ""}
            </Text>
          ) : null}
          <CopyTextButton text={debtReminderText(row)}>Нагадати</CopyTextButton>
        </li>
      ))}
    </ul>
  );
}
