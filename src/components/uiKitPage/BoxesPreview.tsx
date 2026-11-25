import type { BoxCard, BoxListItem } from "@/server/boxes";
import type { PostReturn, PostReturnGroup } from "@/server/np/return-list";
import { parseBoxListParams } from "@/utils/boxListParams";
import BoxCardContent from "../boxesPage/BoxCardContent";
import BoxesPageContent from "../boxesPage/BoxesPageContent";
import BoxReturnsContent from "../boxesPage/BoxReturnsContent";
import GenerateBoxesForm from "../boxesPage/GenerateBoxesForm";
import type { FormAction } from "../clientsPage/clientActions";

/** Реєстр боксів з вигаданими даними: `/ui-kit/shell/<роль>?screen=boxes`. Живих боксів тут немає. */

export const BOX_PREVIEW_SCREENS = [
  "boxes",
  "boxes-empty",
  "box",
  "new-boxes",
  "box-returns",
  "box-returns-empty",
] as const;
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

const postReturn = (n: number, overrides: Partial<PostReturn> = {}): PostReturn => ({
  id: `r${n}`,
  locationId: "l1",
  clientId: `c${n}`,
  clientName: "Кафе «Вогник»",
  orderNumber: 3400 + n,
  boxCodes: [],
  boxSummary: "Довгий 46 л",
  ttnNumber: `2045000000000${n}`,
  state: "waiting",
  statusText: "Прибув у відділення",
  city: "Київ",
  warehouseName: "Відділення №2: вул. Прикладна, 11",
  warehouseNumber: "2",
  waitingDays: 1,
  paidStorageDay: "2026-12-01",
  urgent: false,
  ...overrides,
});

const RETURNS: PostReturnGroup[] = [
  {
    locationId: "l1",
    locationName: "Київ",
    items: [
      postReturn(1, {
        waitingDays: 6,
        paidStorageDay: "2026-11-26",
        urgent: true,
        boxCodes: ["K-0014", "K-0015"],
        boxSummary: "Довгий 46 л × 2",
      }),
      postReturn(2, { clientName: "Ресторан «Причал» з дуже довгою назвою для перевірки" }),
      postReturn(3, {
        clientName: "Бар «Лід»",
        state: "transit",
        statusText: "Відправлення прямує до міста Київ",
        waitingDays: null,
        paidStorageDay: null,
        warehouseName: null,
        boxSummary: null,
      }),
    ],
  },
  {
    locationId: "l2",
    locationName: "Львів",
    items: [
      postReturn(4, {
        locationId: "l2",
        clientName: "Кондитерська «Зима»",
        city: "Львів",
        state: "registered",
        statusText: null,
        waitingDays: null,
        paidStorageDay: null,
        warehouseName: null,
        warehouseNumber: null,
      }),
    ],
  },
];

interface BoxesPreviewProps {
  screen: BoxPreviewScreen;
  isOwner: boolean;
  isProduction: boolean;
  formAction: FormAction;
}

export default function BoxesPreview({
  screen,
  isOwner,
  isProduction,
  formAction,
}: BoxesPreviewProps) {
  if (screen === "box-returns" || screen === "box-returns-empty") {
    return (
      <BoxReturnsContent
        groups={screen === "box-returns" ? (isProduction ? RETURNS.slice(0, 1) : RETURNS) : []}
        showRegistry={isOwner}
        production={isProduction}
        canOpenClient={!isProduction}
      />
    );
  }
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
