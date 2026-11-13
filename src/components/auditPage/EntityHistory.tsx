import type { AuditPage } from "@/server/audit";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import AuditEntryCard from "./AuditEntryCard";

interface EntityHistoryProps {
  page: AuditPage;
  /** Для чого історія («замовлення», «клієнта»): у підписі, коли змін немає. */
  titleId: string;
}

/**
 * «Історія змін» на картці замовлення чи клієнта (ТЗ §11, D91): хто, коли й що змінив, включно з
 * позиціями, цінами й готівкою. Є лише в ролей, які бачать гроші. Показуємо останні записи.
 */
export default function EntityHistory({ page, titleId }: EntityHistoryProps) {
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <SectionTitle id={titleId}>Історія змін</SectionTitle>
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
          Показано останні {page.items.length} змін. Повний журнал: «Ще → Журнал змін».
        </Text>
      ) : null}
    </section>
  );
}
