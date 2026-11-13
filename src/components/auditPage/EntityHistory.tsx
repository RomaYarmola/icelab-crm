import type { AuditPage } from "@/server/audit";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import AuditEntryCard from "./AuditEntryCard";

interface EntityHistoryProps {
  page: AuditPage;
  /** Ідентифікатор заголовка для `aria-labelledby`. */
  titleId: string;
  /** Пояснення під заголовком: що тут показано (`INLINE_HINTS`). */
  description?: string;
}

/**
 * «Історія змін» на картці замовлення чи клієнта (ТЗ §11, D91): хто, коли й що змінив, включно з
 * позиціями, цінами й готівкою. Є лише в ролей, які бачать гроші. Показуємо останні записи.
 */
export default function EntityHistory({ page, titleId, description }: EntityHistoryProps) {
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <SectionTitle id={titleId}>Історія змін</SectionTitle>
      {description ? <Text variant="muted">{description}</Text> : null}
      {page.items.length === 0 ? (
        <Text variant="muted">Змін ще немає.</Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.items.map((entry) => (
            <AuditEntryCard key={entry.id} entry={entry} showSubject={false} />
          ))}
        </ul>
      )}
      {page.hasMore ? (
        <Text variant="muted">
          Показано останні {page.items.length} змін. Повний журнал бачать власник і бухгалтер: «Ще →
          Журнал змін».
        </Text>
      ) : null}
    </section>
  );
}
