import type { BoxCard, BoxListItem } from "@/server/boxes";
import { parseBoxListParams } from "@/utils/boxListParams";
import BoxCardContent from "../boxesPage/BoxCardContent";
import BoxesPageContent from "../boxesPage/BoxesPageContent";
import GenerateBoxesForm from "../boxesPage/GenerateBoxesForm";
import type { FormAction } from "../clientsPage/clientActions";

/** Реєстр боксів з вигаданими даними: `/ui-kit/shell/<роль>?screen=boxes`. Живих боксів тут немає. */

export const BOX_PREVIEW_SCREENS = ["boxes", "boxes-empty", "box", "new-boxes"] as const;
export type BoxPreviewScreen = (typeof BOX_PREVIEW_SCREENS)[number];

const TYPES = [
  { id: "t1", name: "Довгий 46 л" },
  { id: "t2", name: "Малий 19 л" },
];

const item = (n: number, overrides: Partial<BoxListItem> = {}): BoxListItem => ({
  id: `b${n}`,
  code: `K-${String(n).padStart(4, "0")}`,
  boxTypeName: "Довгий 46 л",
  locationName: "Київ",
  status: "in_stock",
  statusLabel: "На складі",
  clientName: null,
  issuedAt: null,
  ...overrides,
});

const ITEMS: BoxListItem[] = [
  item(14, {
    status: "at_client",
    statusLabel: "У клієнта",
    clientName: "Кафе «Вогник»",
    issuedAt: "2026-11-10T09:00:00Z",
  }),
  item(13),
  item(12, { boxTypeName: "Малий 19 л" }),
  item(11, { status: "sold", statusLabel: "Продано" }),
  item(10, { status: "lost", statusLabel: "Втрачено" }),
];

const CARD: BoxCard = {
  id: "b14",
  code: "K-0014",
  boxTypeName: "Довгий 46 л",
  locationId: "l1",
  locationName: "Київ",
  status: "at_client",
  statusLabel: "У клієнта",
  clientId: "c1",
  clientName: "Кафе «Вогник»",
  orderId: "o1",
  orderNumber: 3472,
  issuedAt: "2026-11-10T09:00:00Z",
  labelPrintedAt: "2026-11-01T09:00:00Z",
  history: [
    {
      id: "h3",
      event: "issued",
      occurredAt: "2026-11-10T09:00:00Z",
      actorName: "Андрій Старший",
      clientName: "Кафе «Вогник»",
      orderNumber: 3472,
      note: null,
    },
    {
      id: "h2",
      event: "returned",
      occurredAt: "2026-11-02T14:00:00Z",
      actorName: "Андрій Старший",
      clientName: "ФОП Іваненко",
      orderNumber: 3401,
      note: null,
    },
    {
      id: "h1",
      event: "created",
      occurredAt: "2026-11-01T09:00:00Z",
      actorName: "Олена Коваль",
      clientName: null,
      orderNumber: null,
      note: null,
    },
  ],
};

interface BoxesPreviewProps {
  screen: BoxPreviewScreen;
  isOwner: boolean;
  formAction: FormAction;
}

export default function BoxesPreview({ screen, isOwner, formAction }: BoxesPreviewProps) {
  if (screen === "box") return <BoxCardContent box={CARD} canPrint />;
  if (screen === "new-boxes") {
    return (
      <GenerateBoxesForm
        types={TYPES}
        locations={
          isOwner
            ? [
                { id: "l1", name: "Київ" },
                { id: "l2", name: "Львів" },
              ]
            : null
        }
        createAction={formAction}
        markPrintedAction={formAction}
      />
    );
  }
  return (
    <BoxesPageContent
      items={screen === "boxes" ? ITEMS : []}
      hasMore={screen === "boxes"}
      filters={parseBoxListParams({})}
      types={TYPES}
      showLocation={isOwner}
      canExport={isOwner}
    />
  );
}
