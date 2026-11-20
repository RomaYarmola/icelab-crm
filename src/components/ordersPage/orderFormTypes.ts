import type { ClientListItem } from "@/server/client-views";
import type { DuplicateOrder, OrderTemplate } from "@/server/order-duplicates";
import type { ClientAddressOption, ClientOwnBoxOption, OrderPricing } from "@/server/order-form";
import type { FormAction } from "../clientsPage/clientActions";

/** Клієнт, вибраний у формі замовлення. */
export type PickedClient = { id: string; code: string; name: string };

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
  boxTypeId: string;
  clientOwnBoxId: string;
  boxCount: string;
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
  boxTypes: { id: string; name: string; capacityKg?: string | null }[];
}

/** Додаткова позиція, що створюється разом із замовленням. */
export interface DraftItem {
  key: number;
  kind: "delivery" | "box_sale" | "other";
  title: string;
  qty: string;
  price: string;
}

/** Серверні дії і підказки форми. У каталозі `/ui-kit` це заглушки. */
export interface OrderFormActions {
  submit: FormAction;
  searchClients: (query: string) => Promise<ClientListItem[]>;
  clientAddresses: (clientId: string) => Promise<ClientAddressOption[]>;
  /** Власні бокси клієнта для вибору, коли тара клієнтська (D164). */
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
