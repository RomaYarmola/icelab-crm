import type { clientAddresses, clientContacts, clients } from "@/db/schema";
import { can, type UserRole } from "./permissions";
import type { ClientPriceHistoryItem } from "./prices";

/**
 * Подання клієнта для відповідей сервера (правило проєкту: з сервера в браузер дані йдуть лише
 * через такі функції, див. `dto.ts`). Поля беремо за списком дозволених. Ціни клієнта входять у
 * відповідь лише для ролей з правом читати `client_prices` (власник, менеджер, бухгалтер): старший
 * локації й виробництво не отримують їх ні в списку, ні в картці.
 */

type ClientRow = typeof clients.$inferSelect;
type ContactRow = typeof clientContacts.$inferSelect;
type AddressRow = typeof clientAddresses.$inferSelect;

/** Рядок списку клієнтів: без цін і без службових полів. */
export type ClientListItem = {
  id: string;
  code: string;
  name: string;
  statusId: string | null;
  statusName: string | null;
  managerId: string | null;
  managerName: string | null;
  /** Основний телефон (або перший, якщо основного немає). */
  primaryPhone: string | null;
  isDeleted: boolean;
};

export type ContactView = Pick<ContactRow, "id" | "name" | "phone" | "role" | "isPrimary">;

export function toContactView(contact: ContactRow): ContactView {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    role: contact.role,
    isPrimary: contact.isPrimary,
  };
}

export type AddressView = Pick<
  AddressRow,
  | "id"
  | "kind"
  | "label"
  | "cityText"
  | "addressText"
  | "recipientName"
  | "npWarehouseNumber"
  | "timeWindow"
  | "isDefault"
>;

export function toAddressView(address: AddressRow): AddressView {
  return {
    id: address.id,
    kind: address.kind,
    label: address.label,
    cityText: address.cityText,
    addressText: address.addressText,
    recipientName: address.recipientName,
    npWarehouseNumber: address.npWarehouseNumber,
    timeWindow: address.timeWindow,
    isDefault: address.isDefault,
  };
}

/** Імена зі зв'язаних довідників (їх додає запит, у таблиці клієнтів лише ідентифікатори). */
export type ClientNames = {
  statusName: string | null;
  applicationName: string | null;
  iceTypeName: string | null;
  managerName: string | null;
  sourceName: string | null;
  boxTypeName: string | null;
};

/** Картка клієнта: основні поля, довідникові імена, контакти й адреси; ціни лише за правом. */
export type ClientCardView = Pick<
  ClientRow,
  | "id"
  | "code"
  | "name"
  | "legalType"
  | "edrpou"
  | "iceTypeId"
  | "applicationId"
  | "statusId"
  | "managerId"
  | "sourceId"
  | "defaultBoxTypeId"
  | "markupPercentOverride"
  | "notes"
  | "inactiveDaysThreshold"
  | "isPlaceholder"
  | "mergedIntoId"
  | "createdAt"
  | "updatedAt"
> &
  ClientNames & {
    isDeleted: boolean;
    contacts: ContactView[];
    addresses: AddressView[];
    /** Є лише у ролей з правом на ціни клієнта. */
    prices?: ClientPriceHistoryItem[];
  };

export function toClientCardView(
  client: ClientRow,
  names: ClientNames,
  contacts: ContactRow[],
  addresses: AddressRow[],
  role: UserRole,
  prices: ClientPriceHistoryItem[] | null,
): ClientCardView {
  const view: ClientCardView = {
    id: client.id,
    code: client.code,
    name: client.name,
    legalType: client.legalType,
    edrpou: client.edrpou,
    iceTypeId: client.iceTypeId,
    applicationId: client.applicationId,
    statusId: client.statusId,
    managerId: client.managerId,
    sourceId: client.sourceId,
    defaultBoxTypeId: client.defaultBoxTypeId,
    markupPercentOverride: client.markupPercentOverride,
    notes: client.notes,
    inactiveDaysThreshold: client.inactiveDaysThreshold,
    isPlaceholder: client.isPlaceholder,
    mergedIntoId: client.mergedIntoId,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    ...names,
    isDeleted: client.deletedAt !== null,
    contacts: contacts.map(toContactView),
    addresses: addresses.map(toAddressView),
  };
  // Подвійний захист: ціни додаємо лише коли роль має право, навіть якщо їх передали.
  if (prices && can(role, "client_prices", "read")) view.prices = prices;
  return view;
}
