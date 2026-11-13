import type { AuditEntryView } from "@/server/audit";
import { formatDateTime } from "@/utils/formatDate";
import Disclosure from "../shared/disclosure/Disclosure";
import MainLink from "../shared/links/MainLink";
import Text from "../shared/texts/Text";

interface AuditEntryCardProps {
  entry: AuditEntryView;
  /**
   * Показувати, про що запис («Замовлення № 3472 · Кафе»): на екрані журналу так, а на картці
   * замовлення чи клієнта це зайве, там лише вид запису («Позиція замовлення»).
   */
  showSubject: boolean;
}

/** До скількох змін показуємо список одразу, більше ховаємо в розкривний блок. */
const INLINE_CHANGES = 3;

/**
 * Один запис журналу (D89–D90): хто й коли, речення про те, що зроблено, про що запис (з
 * посиланням) і «було → стало». Створення й видалення показують поля в розкривному блоці, щоб
 * список не розтягувався.
 */
export default function AuditEntryCard({ entry, showSubject }: AuditEntryCardProps) {
  const changeList = (
    <ul className="flex flex-col gap-1.5">
      {entry.changes.map((change) => (
        <li key={change.label} className="text-body break-words text-navy">
          <span className="text-grey-text">{change.label}:</span>{" "}
          {change.before !== null && change.after !== null ? (
            <>
              <span className="text-grey-text">{change.before}</span> →{" "}
              <span className="font-semibold">{change.after}</span>
            </>
          ) : (
            <span className="font-semibold">{change.after ?? change.before}</span>
          )}
        </li>
      ))}
    </ul>
  );

  const showInline = entry.action === "update" && entry.changes.length <= INLINE_CHANGES;

  return (
    <li className="flex flex-col gap-2 rounded-card border border-grey-border bg-grey-light p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Text as="span" className="font-semibold">
          {entry.actorName}
        </Text>
        <Text as="span" variant="muted">
          {formatDateTime(entry.at)}
        </Text>
      </div>
      <Text>{entry.summary}</Text>
      {showSubject ? (
        entry.href ? (
          <MainLink href={entry.href}>{entry.subject}</MainLink>
        ) : (
          <Text variant="muted">{entry.subject}</Text>
        )
      ) : (
        <Text variant="muted">{entry.tableLabel}</Text>
      )}
      {entry.changes.length > 0 ? (
        showInline ? (
          changeList
        ) : (
          <Disclosure variant="plain" summary={`Показати поля (${entry.changes.length})`}>
            {changeList}
          </Disclosure>
        )
      ) : null}
    </li>
  );
}
