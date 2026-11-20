import DraftsContent, { type DraftsActions } from "../draftsPage/DraftsContent";
import type { IntakeDraft } from "@/server/intake/drafts";

const base: IntakeDraft = {
  orderId: "d1",
  number: 3480,
  clientId: "c1",
  clientName: "ДСВ Логістика",
  isPlaceholder: false,
  locationName: "Київ",
  orderDate: "2026-11-18",
  kgSold: "40.000",
  iceName: "16 мм",
  deliveryLabel: "Самовивіз",
  deliveryText: null,
  timeWindow: null,
  boxText: "2 × Довгий 46 л",
  comment: null,
  unclear: [],
  source: "telegram",
  sourceText: "ДСВ завтра 40 кг 16 мм, два бокси",
  createdAt: "2026-11-17T09:30:00.000Z",
  authorName: "Марія Менеджер",
};

/** «Чернетки» з вигаданими даними для каталогу `/ui-kit`. */
export default function DraftsPreview({ actions }: { actions: DraftsActions }) {
  return (
    <DraftsContent
      actions={actions}
      drafts={[
        base,
        {
          ...base,
          orderId: "d2",
          number: 3481,
          clientName: "Новий клієнт",
          isPlaceholder: true,
          kgSold: "0.000",
          iceName: null,
          boxText: null,
          source: "site",
          sourceText: "Ім'я: Іван\nТелефон: +380671110000\nОтримання: Самовивіз",
          unclear: [
            "Клієнта не визначено: «Іван». Оберіть клієнта перед підтвердженням.",
            "Не вказано кілограмів.",
          ],
          authorName: "Олена Коваль",
        },
      ]}
    />
  );
}
