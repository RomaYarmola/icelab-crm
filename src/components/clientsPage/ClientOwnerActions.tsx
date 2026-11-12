import ButtonLink from "../shared/buttons/ButtonLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import type { ClientCardActions } from "./clientActions";
import DeleteRecordForm from "./DeleteRecordForm";
import RestoreClientForm from "./RestoreClientForm";

interface ClientOwnerActionsProps {
  clientId: string;
  isDeleted: boolean;
  /** Клієнта об'єднано з іншим: повернути його не можна. */
  mergedIntoId: string | null;
  actions: Pick<ClientCardActions, "remove" | "restore">;
}

/**
 * Дії власника над клієнтом: об'єднати з дублем, видалити, повернути (D43, D46). Менеджер замість
 * видалення ставить статус «Пауза» чи «Неактуально».
 */
export default function ClientOwnerActions({
  clientId,
  isDeleted,
  mergedIntoId,
  actions,
}: ClientOwnerActionsProps) {
  return (
    <section aria-labelledby="owner-actions" className="flex flex-col gap-3">
      <SectionTitle id="owner-actions">Дії власника</SectionTitle>
      {mergedIntoId ? (
        <Notification variant="info">
          Цього клієнта об’єднано з іншим. Повернути його до списку не можна.
        </Notification>
      ) : isDeleted ? (
        <>
          <Text variant="muted">
            Клієнта приховано зі списку. Його код лишається зайнятим, замовлення збережені.
          </Text>
          <RestoreClientForm clientId={clientId} action={actions.restore} />
        </>
      ) : (
        <>
          <ButtonLink href={`/clients/${clientId}/merge`} variant="outline" fullWidth>
            Об’єднати з дублем
          </ButtonLink>
          <DeleteRecordForm
            action={actions.remove}
            id={clientId}
            summary="Видалити клієнта"
            warning="Клієнта буде приховано зі списку. Його код лишиться зайнятим, а замовлення збережуться. Повернути його зможе власник."
          />
        </>
      )}
    </section>
  );
}
