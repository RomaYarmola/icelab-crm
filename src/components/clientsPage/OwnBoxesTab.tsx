import type { OwnBoxView } from "@/server/client-details";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import type { ClientCardActions } from "./clientActions";
import DeleteRecordForm from "./DeleteRecordForm";
import OwnBoxForm, { EMPTY_OWN_BOX } from "./OwnBoxForm";

interface OwnBoxesTabProps {
  clientId: string;
  boxes: OwnBoxView[];
  actions: ClientCardActions;
  canEdit: boolean;
}

const kgText = (value: string | null) => (value === null ? null : String(Number(value)));

/** Короткий опис бокса: що вміщає, скільки важить, розміри. */
function describe(box: OwnBoxView): string[] {
  const lines: string[] = [];
  if (box.capacityKg) lines.push(`Вміщає: ${kgText(box.capacityKg)} кг`);
  if (box.emptyWeightKg) lines.push(`Порожній важить: ${kgText(box.emptyWeightKg)} кг`);
  if (box.volumeL) lines.push(`Об'єм: ${box.volumeL} л`);
  if (box.heightMm && box.widthMm && box.lengthMm) {
    lines.push(`Розміри зовні (В×Ш×Д): ${box.heightMm}×${box.widthMm}×${box.lengthMm} мм`);
  }
  return lines;
}

/**
 * Вкладка «Бокси клієнта» (D164): бокси, які клієнт надіслав нам для роботи. У замовленні з тарою
 * клієнта обирається один із них, а накладна Нової Пошти бере з нього вагу й розміри.
 */
export default function OwnBoxesTab({ clientId, boxes, actions, canEdit }: OwnBoxesTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <Disclosure key={boxes.length} summary="Додати бокс">
          <OwnBoxForm
            mode="add"
            clientId={clientId}
            defaults={EMPTY_OWN_BOX}
            action={actions.addOwnBox}
            submitLabel="Додати бокс"
          />
        </Disclosure>
      ) : null}

      {boxes.length === 0 ? (
        <EmptyState
          title="Боксів клієнта ще немає"
          description="Додайте бокс клієнта, щоб обирати його в замовленні."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {boxes.map((box) => (
            <Card as="li" key={box.id} className="flex flex-col gap-2">
              <SubTitle className="min-w-0 break-words">{box.name}</SubTitle>
              {box.kind === "dewar" ? <Text variant="muted">Сосуд Дюара (для азоту)</Text> : null}
              {describe(box).map((line) => (
                <Text key={line} variant="muted">
                  {line}
                </Text>
              ))}
              {box.note ? (
                <Text className="break-words whitespace-pre-line">{box.note}</Text>
              ) : null}
              {canEdit ? (
                <div className="flex flex-col gap-1 border-t border-grey-border pt-2">
                  <Disclosure
                    key={`${box.name}-${box.volumeL}-${box.capacityKg}-${box.emptyWeightKg}-${box.heightMm}-${box.widthMm}-${box.lengthMm}-${box.note}`}
                    variant="plain"
                    summary="Змінити"
                  >
                    <OwnBoxForm
                      mode="edit"
                      boxId={box.id}
                      defaults={{
                        name: box.name,
                        kind: box.kind,
                        volumeL: box.volumeL?.toString() ?? "",
                        capacityKg: kgText(box.capacityKg) ?? "",
                        emptyWeightKg: kgText(box.emptyWeightKg) ?? "",
                        heightMm: box.heightMm?.toString() ?? "",
                        widthMm: box.widthMm?.toString() ?? "",
                        lengthMm: box.lengthMm?.toString() ?? "",
                        note: box.note ?? "",
                      }}
                      action={actions.updateOwnBox}
                      submitLabel="Зберегти бокс"
                    />
                  </Disclosure>
                  <DeleteRecordForm
                    action={actions.deleteOwnBox}
                    id={box.id}
                    summary="Видалити бокс"
                    warning="Бокс зникне з картки клієнта, а в замовленнях вибір бокса зніметься. Це не можна скасувати."
                  />
                </div>
              ) : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
