import ExportButton from "../shared/export/ExportButton";
import BackLink from "../shared/links/BackLink";
import MainLink from "../shared/links/MainLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface ExportAllContentProps {
  /** Роль бачить журнал змін (там видно, хто й коли вивантажував). */
  canSeeJournal: boolean;
}

/**
 * Екран «Експорт усього» (B8, D94): одна книга Excel з аркушем на кожну робочу таблицю. Це ручна
 * копія даних для перегляду, а не резервна копія бази.
 */
export default function ExportAllContent({ canSeeJournal }: ExportAllContentProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <BackLink href="/more">Профіль</BackLink>
      <Text variant="muted">
        Уся база одним файлом Excel: окремий аркуш для клієнтів, контактів, адрес, цін, замовлень,
        позицій, історії статусів, змін цін, готівки, довідників і налаштувань. Акаунтів, паролів і
        ключів у файлі немає.
      </Text>
      <Notification variant="info" title="Це не резервна копія">
        Файл зручний, щоб переглянути чи порахувати дані в Excel. Відновити з нього систему не
        можна: для цього призначені резервні копії бази.
      </Notification>
      <div className="flex flex-col gap-2">
        <SectionTitle>Вивантажити</SectionTitle>
        <ExportButton list="all" withPageFilters={false} variant="fill" size="md">
          Експорт усього в Excel
        </ExportButton>
        <Text variant="muted">
          Файл готується кілька секунд. Кожне вивантаження записується в журнал.
        </Text>
      </div>
      {canSeeJournal ? (
        <MainLink href="/more/audit?section=exports">Хто й коли вивантажував</MainLink>
      ) : null}
    </div>
  );
}
