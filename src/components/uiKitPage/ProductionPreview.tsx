import type { ProductionCard, ProductionQueue } from "@/server/production";
import { sortProductionQueue, summarizeProduction } from "@/server/production-rules";
import type { UserRole } from "@/server/permissions";
import type { ProductionActions } from "../productionPage/productionTypes";
import ProductionPageContent from "../productionPage/ProductionPageContent";

/**
 * Екран виробництва з вигаданими даними для перегляду `/ui-kit/shell/<роль>?screen=production`.
 * Картки збирає той самий компонент, що й на сервері: власник і менеджер лише читають, цех бачить
 * «Розпочати» й «Готово», старший локації ще й «Змінити», «Повернути в роботу» та «На стіну».
 */

export const PRODUCTION_PREVIEW_SCREENS = [
  "production",
  "production-empty",
  "production-wall",
] as const;
export type ProductionPreviewScreen = (typeof PRODUCTION_PREVIEW_SCREENS)[number];

const TODAY = "2026-11-13";

function card(
  overrides: Partial<ProductionCard> & Pick<ProductionCard, "id" | "number">,
): ProductionCard {
  return {
    locationId: "preview-kyiv",
    locationName: "Київ",
    status: "confirmed",
    orderDate: TODAY,
    clientCode: "АА15",
    clientName: "Кафе «Вогник»",
    iceTypeId: "ice-16",
    iceTypeName: "16 мм",
    kgSold: "30.000",
    kgToProduce: "33.000",
    boxTypeName: "Наш довгий 46 л",
    boxCount: 2,
    boxOwnership: "ours",
    deliveryMethod: "our_delivery",
    deliveryPlace: "Київ, вул. Сагайдачного, 12",
    timeWindow: "10:00-14:00",
    comment: "Пакувати в два бокси, привезти до 10:00.",
    isNew: false,
    ...overrides,
  };
}

const CARDS: ProductionCard[] = [
  card({ id: "o1", number: 3475, status: "confirmed", isNew: true, timeWindow: "09:00-11:00" }),
  card({
    id: "o2",
    number: 3474,
    status: "in_production",
    clientCode: "ВС57",
    clientName: "ФОП Іваненко Петро Олексійович",
    iceTypeId: "ice-3",
    iceTypeName: "3 мм",
    kgSold: "12.000",
    kgToProduce: "14.000",
    boxTypeName: "Бокс клієнта",
    boxCount: 1,
    boxOwnership: "client",
    deliveryMethod: "np",
    deliveryPlace: "Харків, відділення №7",
    timeWindow: "12:00",
    comment: null,
  }),
  card({
    id: "o3",
    number: 3473,
    status: "in_production",
    clientCode: "АІ8",
    clientName: "Івент-агенція «Дим»",
    iceTypeId: "ice-19",
    iceTypeName: "19 мм",
    kgSold: "60.000",
    kgToProduce: "66.000",
    boxTypeName: null,
    boxCount: 0,
    deliveryMethod: "pickup",
    deliveryPlace: "Самовивіз",
    timeWindow: null,
    comment: "Забере клієнт о 15:00.",
  }),
  card({
    id: "o4",
    number: 3472,
    status: "packed",
    clientCode: "21",
    clientName: "Склад №4",
    kgSold: "25.000",
    kgToProduce: "25.000",
    timeWindow: "08:00-10:00",
    comment: null,
  }),
];

function queueFor(screen: ProductionPreviewScreen): ProductionQueue {
  const cards = screen === "production-empty" ? [] : CARDS;
  return {
    date: TODAY,
    generatedAt: "2026-11-13T12:05:00Z",
    locationId: "preview-kyiv",
    cards: sortProductionQueue(cards),
    summary: summarizeProduction(cards),
    newCount: cards.filter((item) => item.isNew).length,
  };
}

interface ProductionPreviewProps {
  role: UserRole;
  screen: ProductionPreviewScreen;
  actions: ProductionActions;
}

export default function ProductionPreview({ role, screen, actions }: ProductionPreviewProps) {
  const isLead = role === "location_lead";
  return (
    <ProductionPageContent
      queue={queueFor(screen)}
      today={TODAY}
      wall={screen === "production-wall" && isLead}
      canWork={isLead || role === "production"}
      canEdit={isLead}
      locationLabel="Київ"
      realtime={null}
      actions={actions}
    />
  );
}
