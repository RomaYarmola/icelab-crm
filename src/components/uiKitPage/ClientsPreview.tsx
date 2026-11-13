import { CLIENT_TABS, type ClientTab } from "@/constants/clients";
import type { LoadMoreResult } from "@/app/(app)/clients/actions";
import type { ClientFormOptions } from "@/server/client-options";
import type { AuditPage } from "@/server/audit";
import type { MergePreview } from "@/server/client-merge";
import type { ClientCardView, ClientListItem } from "@/server/client-views";
import type { SimilarClient } from "@/server/clients";
import { can, type UserRole } from "@/server/permissions";
import type { ClientPriceHistoryItem, DefaultPriceHistoryItem } from "@/server/prices";
import type { FormState } from "@/utils/formState";
import { PREVIEW_AUDIT_ENTRIES } from "./AuditPreview";
import ClientCardContent from "../clientsPage/ClientCardContent";
import ClientsPageContent from "../clientsPage/ClientsPageContent";
import MergeClientsContent from "../clientsPage/MergeClientsContent";
import NewClientContent from "../clientsPage/NewClientContent";
import PricesPageContent from "../pricesPage/PricesPageContent";

/**
 * Екрани клієнтів і прайсу з вигаданими даними для перегляду `/ui-kit/shell/<роль>?screen=…`.
 * Нічого не зберігають: дії-заглушки лише відповідають успіхом. Показують те, що бачить роль
 * (наприклад, старший локації не бачить вкладки «Ціни»).
 */

export const CLIENT_PREVIEW_SCREENS = [
  "clients",
  "clients-empty",
  "clients-found-nothing",
  "new-client",
  "client",
  "client-deleted",
  "prices",
  "merge",
  "merge-summary",
] as const;
export type ClientPreviewScreen = (typeof CLIENT_PREVIEW_SCREENS)[number];

const TODAY = "2026-11-12";

const OPTIONS: ClientFormOptions = {
  regions: [
    { prefix: "АА", name: "Київ" },
    { prefix: "АІ", name: "Київська область" },
    { prefix: "ВС", name: "Львівська область" },
    { prefix: "ВО", name: "Тернопільська область" },
  ],
  iceTypes: [
    { id: "ice-3", name: "3 мм" },
    { id: "ice-16", name: "16 мм" },
    { id: "ice-19", name: "19 мм" },
  ],
  applications: [
    { id: "app-bar", name: "Бар" },
    { id: "app-logistics", name: "Логістика" },
    { id: "app-kids", name: "Дитячі свята" },
  ],
  statuses: [
    { id: "st-active", name: "Активний" },
    { id: "st-warm", name: "Підігрітий" },
    { id: "st-paused", name: "Пауза" },
    { id: "st-irrelevant", name: "Неактуально" },
  ],
  sources: [
    { id: "src-site", name: "Сайт" },
    { id: "src-phone", name: "Телефон" },
  ],
  boxTypes: [{ id: "box-46", name: "Наш довгий 46 л" }],
  managers: [
    { id: "mgr-1", name: "Олена Коваль" },
    { id: "mgr-2", name: "Марія Менеджер" },
  ],
};

const LIST: ClientListItem[] = [
  {
    id: "c1",
    code: "АА15",
    name: "Кафе «Вогник»",
    statusId: "st-active",
    statusName: "Активний",
    managerId: "mgr-1",
    managerName: "Олена Коваль",
    primaryPhone: "+380501234567",
    isDeleted: false,
  },
  {
    id: "c2",
    code: "ВС57",
    name: "ФОП Іваненко Петро Олексійович",
    statusId: "st-warm",
    statusName: "Підігрітий",
    managerId: "mgr-2",
    managerName: "Марія Менеджер",
    primaryPhone: "+380679998877",
    isDeleted: false,
  },
  {
    id: "c3",
    code: "21",
    name: "Склад №4",
    statusId: "st-paused",
    statusName: "Пауза",
    managerId: null,
    managerName: null,
    primaryPhone: null,
    isDeleted: false,
  },
  {
    id: "c4",
    code: "АІ8",
    name: "Івент-агенція «Дим»",
    statusId: "st-active",
    statusName: "Активний",
    managerId: "mgr-1",
    managerName: "Олена Коваль",
    primaryPhone: "+380931112233",
    isDeleted: true,
  },
];

const CLIENT_PRICES: ClientPriceHistoryItem[] = [
  {
    id: "p1",
    iceTypeId: "ice-16",
    iceTypeName: "16 мм",
    pricePerKg: "70.00",
    validFrom: "2026-10-01",
    validTo: null,
  },
  {
    id: "p2",
    iceTypeId: "ice-16",
    iceTypeName: "16 мм",
    pricePerKg: "65.00",
    validFrom: "2026-06-01",
    validTo: "2026-09-30",
  },
  {
    id: "p3",
    iceTypeId: null,
    iceTypeName: null,
    pricePerKg: "68.00",
    validFrom: "2026-11-20",
    validTo: null,
  },
];

const DEFAULT_PRICES: DefaultPriceHistoryItem[] = [
  {
    id: "d1",
    iceTypeId: "ice-3",
    iceTypeName: "3 мм",
    pricePerKg: "80.00",
    validFrom: "2026-01-01",
    validTo: null,
  },
  {
    id: "d2",
    iceTypeId: "ice-16",
    iceTypeName: "16 мм",
    pricePerKg: "75.00",
    validFrom: "2026-01-01",
    validTo: null,
  },
  {
    id: "d3",
    iceTypeId: "ice-19",
    iceTypeName: "19 мм",
    pricePerKg: "72.00",
    validFrom: "2026-03-01",
    validTo: null,
  },
  {
    id: "d4",
    iceTypeId: "ice-19",
    iceTypeName: "19 мм",
    pricePerKg: "70.00",
    validFrom: "2025-09-01",
    validTo: "2026-02-28",
  },
];

function cardFor(role: UserRole, overrides: Partial<ClientCardView> = {}): ClientCardView {
  const client: ClientCardView = {
    id: "c1",
    code: "АА15",
    name: "Кафе «Вогник»",
    legalType: "fop",
    edrpou: "1234567890",
    iceTypeId: "ice-16",
    applicationId: "app-bar",
    statusId: "st-active",
    managerId: "mgr-1",
    sourceId: "src-site",
    defaultBoxTypeId: "box-46",
    markupPercentOverride: "5.00",
    notes: "Просить привозити до 10:00.",
    inactiveDaysThreshold: 30,
    isPlaceholder: false,
    mergedIntoId: null,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-11-10"),
    statusName: "Активний",
    applicationName: "Бар",
    iceTypeName: "16 мм",
    managerName: "Олена Коваль",
    sourceName: "Сайт",
    boxTypeName: "Наш довгий 46 л",
    isDeleted: false,
    contacts: [
      {
        id: "ct1",
        name: "Марія Петренко",
        phone: "+380501234567",
        role: "Закупівлі",
        isPrimary: true,
      },
      { id: "ct2", name: "Іван", phone: "+380671112233", role: null, isPrimary: false },
    ],
    addresses: [
      {
        id: "ad1",
        kind: "delivery",
        label: "Бар на Подолі",
        cityText: "Київ",
        addressText: "вул. Сагайдачного, 12",
        recipientName: "Марія",
        npWarehouseNumber: null,
        timeWindow: "10:00-14:00",
        isDefault: true,
      },
      {
        id: "ad2",
        kind: "np_warehouse",
        label: null,
        cityText: "Львів",
        addressText: null,
        recipientName: null,
        npWarehouseNumber: "14",
        timeWindow: null,
        isDefault: false,
      },
    ],
    ...overrides,
  };
  // Ціни є лише в ролей з правом на них: так само, як це робить `toClientCardView`.
  if (can(role, "client_prices", "read")) client.prices = CLIENT_PRICES;
  return client;
}

const MERGE_PREVIEW: MergePreview = {
  main: { id: "c1", code: "АА15", name: "Кафе «Вогник»" },
  duplicate: { id: "c9", code: "АА16", name: "Кафе Вогник (дубль)" },
  moves: {
    contacts: 1,
    addresses: 2,
    priceTypes: 1,
    priceTypesKept: 1,
    references: { orders: 3 },
  },
};

interface ClientsPreviewProps {
  role: UserRole;
  screen: ClientPreviewScreen;
  tab: string | undefined;
  /** Адреса каталогу, на яку ведуть вкладки картки: `?screen=client&tab=…`. */
  tabBase: string;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  loadMore: () => Promise<LoadMoreResult>;
  previewCode: () => Promise<string | null>;
  findSimilar: () => Promise<SimilarClient[]>;
}

export default function ClientsPreview({
  role,
  screen,
  tab,
  tabBase,
  action,
  loadMore,
  previewCode,
  findSimilar,
}: ClientsPreviewProps) {
  const canWrite = can(role, "clients", "write");
  const filters = {
    search: "",
    statusId: "",
    managerId: "",
    applicationId: "",
    includeDeleted: false,
  };

  if (screen === "clients" || screen === "clients-empty" || screen === "clients-found-nothing") {
    const items = screen === "clients" ? (role === "owner" ? LIST : LIST.slice(0, 3)) : [];
    return (
      <ClientsPageContent
        page={{ items, hasMore: screen === "clients" }}
        filters={screen === "clients-found-nothing" ? { ...filters, search: "Вогнык" } : filters}
        options={OPTIONS}
        canCreate={canWrite}
        canSeeDeleted={role === "owner"}
        loadMore={loadMore}
      />
    );
  }

  if (screen === "new-client") {
    return (
      <NewClientContent
        options={OPTIONS}
        defaultManagerId="mgr-1"
        actions={{ create: action, previewCode, findSimilar }}
      />
    );
  }

  if (screen === "prices") {
    return (
      <PricesPageContent
        prices={DEFAULT_PRICES}
        iceTypes={OPTIONS.iceTypes}
        today={TODAY}
        canEdit={can(role, "default_prices", "write")}
        action={action}
      />
    );
  }

  if (screen === "merge" || screen === "merge-summary") {
    return (
      <MergeClientsContent
        main={MERGE_PREVIEW.main}
        candidates={screen === "merge" ? [{ ...LIST[1]!, id: "c9" }] : []}
        query={screen === "merge" ? "іван" : ""}
        preview={screen === "merge-summary" ? MERGE_PREVIEW : null}
        previewError={null}
        action={action}
      />
    );
  }

  const activeTab: ClientTab = CLIENT_TABS.find((id) => id === tab) ?? "main";
  const noop = action;
  // Історія змін клієнта (ТЗ §11): лише ролі з правом на ціни клієнта.
  const canSeeHistory = can(role, "client_prices", "read");
  const history: AuditPage | null =
    canSeeHistory && activeTab === "history"
      ? {
          items: PREVIEW_AUDIT_ENTRIES.filter((item) => item.sectionLabel === "Замовлення")
            .slice(0, 3)
            .map((item) => ({ ...item, tableLabel: "Клієнт", href: null })),
          hasMore: false,
        }
      : null;
  return (
    <ClientCardContent
      client={cardFor(role, screen === "client-deleted" ? { isDeleted: true } : {})}
      tab={activeTab}
      options={OPTIONS}
      defaultPrices={can(role, "default_prices", "read") ? DEFAULT_PRICES : null}
      canSeeHistory={canSeeHistory}
      history={history}
      today={TODAY}
      tabHref={(id) => (id === "main" ? tabBase : `${tabBase}&tab=${id}`)}
      permissions={{
        canWrite,
        canEditPrices: can(role, "client_prices", "write"),
        isOwner: role === "owner",
      }}
      actions={{
        update: noop,
        assignRegion: noop,
        remove: noop,
        restore: noop,
        addContact: noop,
        updateContact: noop,
        deleteContact: noop,
        addAddress: noop,
        updateAddress: noop,
        deleteAddress: noop,
        changePrice: noop,
      }}
    />
  );
}
