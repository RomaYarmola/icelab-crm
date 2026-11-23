import type { ClientListItem } from "@/server/client-views";
import type { DuplicateOrder, OrderTemplate } from "@/server/order-duplicates";
import type { ClientAddressOption, ClientOwnBoxOption, OrderPricing } from "@/server/order-form";
import type { FormAction } from "../clientsPage/clientActions";

/** Клієнт, вибраний у формі замовлення. */
export type PickedClient = { id: string; code: string; name: string };

/** Рядок тари у формі: вид бокса (наш тип або бокс клієнта) і кількість рядком. */
export interface BoxLineDraft {
  key: number;
  /** Чий бокс у цьому рядку: наш чи клієнта (20.11.2026: питаємо для кожного рядка). */
  owner: "ours" | "client";
  boxTypeId: string;
  clientOwnBoxId: string;
  count: string;
}

/** Рядок «бокс на продаж»: вид, кількість і ціна за штуку (порожня означає «за прайсом»). */
export interface BoxSaleDraft {
  key: number;
  boxTypeId: string;
  qty: string;
  price: string;
}

/** Усі поля форми замовлення рядками: так вони живуть у полях введення. */
export interface OrderFormValues {
  locationId: string;
  orderDate: string;
  iceTypeId: string;
  kgSold: string;
  kgToProduce: string;
  sourceId: string;
  deliveryMethod: string;
  addressId: string;
  deliveryText: string;
  timeWindow: string;
  recipientName: string;
  recipientPhone: string;
  /** Тара рядками: що й скільки (20.11.2026). */
  boxLines: BoxLineDraft[];
  /** Бокси на продаж (D174). */
  boxSales: BoxSaleDraft[];
  /** Рідкий азот (D176): кг і ціна за кг (порожня: за прайсом). */
  nitrogen: { qty: string; price: string };
  boxOwnership: string;
  paymentKind: string;
  comment: string;
  internalComment: string;
}

/** Довідники для списків вибору у формі замовлення. */
export interface OrderFormOptions {
  locations: { id: string; name: string }[];
  iceTypes: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  /** `capacityKg`: скільки кг вміщає бокс (для підказки «виготовити», D165). */
  boxTypes: {
    id: string;
    name: string;
    capacityKg?: string | null;
    isClientOwned?: boolean;
    /** `dewar` сосуд Дюара: не продається й не вміщає лід. */
    kind?: string;
  }[];
  /** Чинні ціни прайсу боксів: тип → ціна за штуку (D175). */
  boxPrices?: Record<string, string>;
  /** Чинна ціна рідкого азоту за кг (D176). */
  nitrogenPrice?: string | null;
}

/** Серверні дії і підказки форми. У каталозі `/ui-kit` це заглушки. */
export interface OrderFormActions {
  submit: FormAction;
  searchClients: (query: string) => Promise<ClientListItem[]>;
  clientAddresses: (clientId: string) => Promise<ClientAddressOption[]>;
  /** Бокси клієнта для вибору, коли тара клієнтська (D164). */
  clientOwnBoxes: (clientId: string) => Promise<ClientOwnBoxOption[]>;
  pricing: (input: {
    clientId: string;
    iceTypeId?: string | null;
    orderDate: string;
    deliveryMethod?: string | null;
  }) => Promise<OrderPricing | null>;
  findDuplicates: (input: {
    clientId: string;
    orderDate: string;
    iceTypeId?: string | null;
    excludeId?: string;
  }) => Promise<DuplicateOrder[]>;
  repeatLast: (clientId: string) => Promise<OrderTemplate | null>;
}
