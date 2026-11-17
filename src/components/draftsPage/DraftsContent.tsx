import Link from "next/link";
import { INLINE_HINTS, SCREEN_HINTS } from "@/constants/hints";
import type { IntakeDraft } from "@/server/intake/drafts";
import { formatIsoDate } from "@/utils/isoDate";
import { formatDateTime } from "@/utils/formatDate";
import DeleteRecordForm from "../clientsPage/DeleteRecordForm";
import type { FormAction } from "../clientsPage/clientActions";
import ActionForm from "../intakePage/ActionForm";
import ButtonLink from "../shared/buttons/ButtonLink";
import Tag from "../shared/chips/Tag";
import EmptyState from "../shared/emptyState/EmptyState";
import ScreenHint from "../shared/hint/ScreenHint";
import OrdersIcon from "../shared/icons/OrdersIcon";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import OrdersTabs from "./OrdersTabs";

export interface DraftsActions {
  confirm: FormAction;
  reject: FormAction;
}

interface DraftsContentProps {
  drafts: IntakeDraft[];
  actions: DraftsActions;
}

const SOURCE_LABELS = { telegram: "Telegram", site: "Сайт" } as const;
const NOT_SET = "Не вказано";

/** Розпізнані поля чернетки: порожнє значення (`null`) підсвічується. */
function fieldsOf(draft: IntakeDraft): { label: string; value: string | null }[] {
  const kg = Number(draft.kgSold);
  return [
    { label: "Дата", value: formatIsoDate(draft.orderDate) },
    { label: "Кілограмів", value: kg > 0 ? `${kg.toLocaleString("uk-UA")} кг` : null },
    { label: "Тип льоду", value: draft.iceName },
    {
      label: "Доставка",
      value:
        [draft.deliveryLabel, draft.deliveryText, draft.timeWindow].filter(Boolean).join(", ") ||
        null,
    },
    { label: "Тара", value: draft.boxText },
    { label: "Коментар", value: draft.comment },
  ];
}

/**
 * Вкладка «Чернетки» (ТЗ 6.9): кожна заявка з Telegram чи сайту з вихідним текстом, розпізнаними
 * полями (порожні підсвічені) і кнопками. Чернетку без визначеного клієнта підтвердити не можна:
 * спершу «Виправити» й вибір справжнього клієнта.
 */
export default function DraftsContent({ drafts, actions }: DraftsContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <OrdersTabs active="drafts" draftsCount={drafts.length} />
      <ScreenHint hint={SCREEN_HINTS.drafts} />
      {drafts.length === 0 ? (
        <EmptyState
          icon={<OrdersIcon className="size-10" />}
          title="Чернеток немає"
          description={INLINE_HINTS.draftsEmpty}
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {drafts.map((draft) => (
            <li
              key={draft.orderId}
              className="flex flex-col gap-3 rounded-card border border-grey-field bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/orders/${draft.orderId}`}
                    className="text-h2 break-words text-navy underline-offset-2 lg:hover:underline"
                  >
                    {draft.clientName}
                    {draft.number ? ` · № ${draft.number}` : ""}
                  </Link>
                  <Text variant="muted">
                    {draft.locationName} · {formatDateTime(new Date(draft.createdAt))}
                    {draft.authorName ? ` · ${draft.authorName}` : ""}
                  </Text>
                </div>
                <Tag className="shrink-0">{SOURCE_LABELS[draft.source]}</Tag>
              </div>

              {draft.sourceText ? (
                <blockquote className="rounded-field bg-grey-light px-4 py-3 text-body whitespace-pre-line text-navy">
                  {draft.sourceText}
                </blockquote>
              ) : null}

              {draft.isPlaceholder ? (
                <Notification variant="warning">
                  Клієнта не визначено. Натисніть «Виправити» й оберіть клієнта, тоді можна
                  підтвердити.
                </Notification>
              ) : null}

              <dl className="flex flex-col gap-3">
                {fieldsOf(draft).map((field) => (
                  <div key={field.label} className="flex flex-col gap-0.5">
                    <dt>
                      <Text as="span" variant="muted">
                        {field.label}
                      </Text>
                    </dt>
                    <dd className="text-body break-words whitespace-pre-line text-navy">
                      {field.value ? (
                        field.value
                      ) : (
                        // Порожні поля підсвічені: це те, що система не змогла розпізнати (ТЗ 6.9).
                        <span className="inline-block rounded-field bg-status-in-production px-2 text-status-in-production-text">
                          {NOT_SET}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              {draft.unclear.length > 0 ? (
                <Notification variant="info" title="Неясно">
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {draft.unclear.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </Notification>
              ) : null}

              <div className="flex flex-col gap-2">
                {draft.isPlaceholder ? null : (
                  <ActionForm
                    action={actions.confirm}
                    fields={{ orderId: draft.orderId }}
                    label="Підтвердити"
                    loadingText="Підтверджуємо…"
                    variant="fill"
                  />
                )}
                <ButtonLink href={`/orders/${draft.orderId}/edit`} variant="outline">
                  Виправити
                </ButtonLink>
                <DeleteRecordForm
                  action={actions.reject}
                  id={draft.orderId}
                  summary="Відхилити"
                  warning="Чернетку буде видалено. Заявка лишиться в історії приймання."
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
