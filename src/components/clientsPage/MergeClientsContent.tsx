import Link from "next/link";
import type { ClientListItem } from "@/server/client-views";
import type { MergePreview } from "@/server/client-merge";
import { pluralUk } from "@/utils/plural";
import ButtonLink from "../shared/buttons/ButtonLink";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import EmptyState from "../shared/emptyState/EmptyState";
import BackLink from "../shared/links/BackLink";
import Notification from "../shared/notification/Notification";
import SearchField from "../shared/search/SearchField";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import type { FormAction } from "./clientActions";
import MergeConfirmForm from "./MergeConfirmForm";

/** Назви таблиць, що посилаються на клієнта, для підсумку. Невідомі показуємо за назвою таблиці. */
const REFERENCE_LABELS: Record<string, string> = {
  orders: "Замовлення",
  boxes: "Бокси",
  payments: "Оплати",
};

interface MergeClientsContentProps {
  main: { id: string; code: string; name: string };
  /** Результат пошуку дубля (коли дубль ще не вибрано). */
  candidates: ClientListItem[];
  /** Пошуковий запит у полі (з адреси). */
  query: string;
  /** Підсумок «що перейде», коли дубль вибрано. */
  preview: MergePreview | null;
  /** Чому підсумок не вдалося зібрати (клієнта видалено, той самий клієнт тощо). */
  previewError: string | null;
  action: FormAction;
}

function MoveRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <Text as="span">{label}</Text>
      <Text as="span" variant="label">
        {value}
      </Text>
    </li>
  );
}

/**
 * Об'єднання дублів (лише власник, D46): картка, з якої почали, це головний клієнт; пошуком
 * вибирається дубль, далі підсумок «що перейде» і підтвердження. Відкату немає, слід лишається в
 * журналі змін.
 */
export default function MergeClientsContent({
  main,
  candidates,
  query,
  preview,
  previewError,
  action,
}: MergeClientsContentProps) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href={`/clients/${main.id}`}>Картка клієнта</BackLink>
      <SectionTitle>Об’єднати з дублем</SectionTitle>

      <Card className="flex flex-col gap-1">
        <Text variant="muted">Головний клієнт: залишається в системі</Text>
        <div className="flex items-start justify-between gap-3">
          <SubTitle className="min-w-0 break-words">{main.name}</SubTitle>
          <Tag className="shrink-0">{main.code}</Tag>
        </div>
      </Card>

      {preview ? (
        <section aria-labelledby="merge-summary" className="flex flex-col gap-4">
          <Card className="flex flex-col gap-1">
            <Text variant="muted">Дубль: буде прихований</Text>
            <div className="flex items-start justify-between gap-3">
              <SubTitle className="min-w-0 break-words">{preview.duplicate.name}</SubTitle>
              <Tag className="shrink-0">{preview.duplicate.code}</Tag>
            </div>
          </Card>

          <SectionTitle id="merge-summary">Що перейде до головного</SectionTitle>
          <ul className="flex flex-col gap-2">
            <MoveRow label="Контакти" value={preview.moves.contacts} />
            <MoveRow label="Адреси" value={preview.moves.addresses} />
            <MoveRow label="Типи льоду з цінами" value={preview.moves.priceTypes} />
            {Object.entries(preview.moves.references).map(([table, count]) => (
              <MoveRow key={table} label={REFERENCE_LABELS[table] ?? table} value={count} />
            ))}
          </ul>
          {preview.moves.priceTypesKept > 0 ? (
            <Text variant="muted">
              Ціни на {preview.moves.priceTypesKept}{" "}
              {pluralUk(preview.moves.priceTypesKept, ["тип", "типи", "типів"])} льоду лишаються в
              дубля, бо в головного клієнта вже є своя ціна.
            </Text>
          ) : null}
          <Notification variant="warning">
            Це не можна скасувати: дубль зникне зі списку. Усі зміни збережуться в журналі.
          </Notification>

          <MergeConfirmForm mainId={main.id} duplicateId={preview.duplicate.id} action={action} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink
              href={`/clients/${preview.duplicate.id}/merge?duplicate=${main.id}`}
              variant="outline"
              fullWidth
            >
              Поміняти місцями
            </ButtonLink>
            <ButtonLink href={`/clients/${main.id}/merge`} variant="ghost" fullWidth>
              Обрати іншого
            </ButtonLink>
          </div>
        </section>
      ) : (
        <section aria-labelledby="merge-pick" className="flex flex-col gap-4">
          <SectionTitle id="merge-pick">Хто дубль?</SectionTitle>
          {previewError ? <Notification variant="error">{previewError}</Notification> : null}
          <Text variant="muted">
            Знайдіть клієнта, якого треба влити в головного: за кодом, назвою чи телефоном.
          </Text>
          <SearchField label="Пошук дубля" placeholder="Код, назва чи телефон" />
          {query === "" ? null : candidates.length === 0 ? (
            <EmptyState title="Нічого не знайдено" description="Спробуйте іншу назву чи код." />
          ) : (
            <ul className="flex flex-col gap-3">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link
                    href={`/clients/${main.id}/merge?duplicate=${candidate.id}`}
                    className="flex flex-col gap-1 rounded-card border border-grey-border bg-grey-light p-4 transition active:scale-[98%] lg:hover:border-grey-field"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <SubTitle className="min-w-0 break-words">{candidate.name}</SubTitle>
                      <Tag className="shrink-0">{candidate.code}</Tag>
                    </div>
                    {candidate.statusName ? (
                      <Text variant="muted">{candidate.statusName}</Text>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
