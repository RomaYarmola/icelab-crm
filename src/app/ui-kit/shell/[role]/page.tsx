import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProfileContent from "@/components/profilePage/ProfileContent";
import AppShell from "@/components/shared/layout/AppShell";
import NewUserContent from "@/components/usersPage/NewUserContent";
import AuditPreview, {
  AUDIT_PREVIEW_SCREENS,
  type AuditPreviewScreen,
} from "@/components/uiKitPage/AuditPreview";
import ExportAllContent from "@/components/exportPage/ExportAllContent";
import CashPreview, {
  CASH_PREVIEW_SCREENS,
  type CashPreviewScreen,
} from "@/components/uiKitPage/CashPreview";
import ClientsPreview, {
  CLIENT_PREVIEW_SCREENS,
  type ClientPreviewScreen,
} from "@/components/uiKitPage/ClientsPreview";
import OrdersPreview, {
  ORDER_PREVIEW_SCREENS,
  type OrderPreviewScreen,
} from "@/components/uiKitPage/OrdersPreview";
import ProductionPreview, {
  PRODUCTION_PREVIEW_SCREENS,
  type ProductionPreviewScreen,
} from "@/components/uiKitPage/ProductionPreview";
import ShellPreviewContent from "@/components/uiKitPage/ShellPreviewContent";
import UserDetailContent from "@/components/usersPage/UserDetailContent";
import UsersPageContent from "@/components/usersPage/UsersPageContent";
import type { AppUser } from "@/server/guards";
import { buildLocationFilter, type LocationOption } from "@/server/locations";
import { can, isLocationBound, ROLE_LABELS, USER_ROLES, type UserRole } from "@/server/permissions";
import type { LoadMoreResult } from "@/app/(app)/clients/actions";
import type { LoadMoreOrdersResult } from "@/app/(app)/orders/actions";
import type { ClientListItem } from "@/server/client-views";
import type { SimilarClient } from "@/server/clients";
import type { DuplicateOrder, OrderTemplate } from "@/server/order-duplicates";
import type { ClientAddressOption, OrderPricing } from "@/server/order-form";
import type { UserListItem } from "@/server/users";
import type { FormState } from "@/utils/formState";

export const metadata: Metadata = { title: "Перегляд оболонки", robots: { index: false } };

const PREVIEW_LOCATIONS: LocationOption[] = [
  { id: "preview-kyiv", name: "Київ" },
  { id: "preview-lviv", name: "Львів" },
];

/** Заглушка збереження вибору локації: у каталозі справжньої cookie і входу немає. */
async function previewSetLocation(): Promise<{ ok: boolean }> {
  "use server";
  return { ok: true };
}

/** Заглушка відправки форм у каталозі: нічого не зберігає. */
async function previewFormAction(): Promise<FormState> {
  "use server";
  return { status: "success", message: "Приклад: у каталозі збереження вимкнено." };
}

/** Заглушка «екран виробництва відкрито»: у каталозі нічого не запускає й не позначає. */
async function previewOpenScreen(): Promise<{ status: "ok"; started: number; marked: number }> {
  "use server";
  return { status: "ok", started: 0, marked: 0 };
}

/** Заглушка «Показати ще» у журналі змін: нічого не довантажує. */
async function previewLoadMoreAudit(): Promise<{ ok: true; page: { items: []; hasMore: false } }> {
  "use server";
  return { ok: true, page: { items: [], hasMore: false } };
}

/** Заглушки читання в каталозі: список без довантаження, підказка коду й схожі клієнти для прикладу. */
async function previewLoadMore(): Promise<LoadMoreResult> {
  "use server";
  return { ok: true, page: { items: [], hasMore: false } };
}

async function previewLoadMoreOrders(): Promise<LoadMoreOrdersResult> {
  "use server";
  return { ok: true, page: { items: [], hasMore: false } };
}

async function previewSearchClients(): Promise<ClientListItem[]> {
  "use server";
  return [
    {
      id: "c1",
      code: "АА15",
      name: "Кафе «Вогник»",
      statusId: null,
      statusName: "Активний",
      managerId: null,
      managerName: null,
      primaryPhone: "+380501234567",
      isDeleted: false,
    },
    {
      id: "c2",
      code: "ВС57",
      name: "ФОП Іваненко",
      statusId: null,
      statusName: null,
      managerId: null,
      managerName: null,
      primaryPhone: null,
      isDeleted: false,
    },
  ];
}

async function previewAddresses(): Promise<ClientAddressOption[]> {
  "use server";
  return [
    { id: "ad1", text: "Доставка: Кафе на Подолі, Київ, вул. Сагайдачного, 12", isDefault: true },
    { id: "ad2", text: "Склад Нової Пошти: Львів, відділення № 14", isDefault: false },
  ];
}

async function previewPricing(): Promise<OrderPricing | null> {
  "use server";
  return {
    source: "default",
    pricePerKg: "75.00",
    markupPercent: 10,
    markupSettings: { npPercent: 10, eventPercent: 10 },
  };
}

async function previewDuplicates(): Promise<DuplicateOrder[]> {
  "use server";
  return [
    {
      id: "o1",
      number: 3472,
      status: "confirmed",
      orderDate: "2026-11-13",
      kgSold: "30.000",
      locationId: "preview-kyiv",
    },
  ];
}

async function previewRepeat(): Promise<OrderTemplate | null> {
  "use server";
  return {
    fromOrderId: "o1",
    fromNumber: 3472,
    locationId: "preview-kyiv",
    iceTypeId: "ice-16",
    kgSold: "30.000",
    sourceId: "src-phone",
    deliveryMethod: "np",
    addressId: "ad2",
    deliveryText: null,
    timeWindow: "10:00-14:00",
    recipientName: "Марія Петренко",
    recipientPhone: "+380501234567",
    boxTypeId: "box-46",
    boxCount: 2,
    boxOwnership: "ours",
    paymentKind: "fop",
    items: [
      {
        kind: "delivery",
        title: "Доставка по Києву",
        qty: "1.000",
        unit: "послуга",
        boxTypeId: null,
      },
    ],
  };
}

async function previewCode(): Promise<string | null> {
  "use server";
  return "АА16";
}

async function previewSimilar(): Promise<SimilarClient[]> {
  "use server";
  return [{ id: "c1", code: "АА15", name: "Кафе «Вогник»", reason: "name" }];
}

/** Вигадані користувачі для переглядів екранів «Користувачі». */
const PREVIEW_USERS: UserListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "olena.koval@example.com",
    fullName: "Олена Коваль",
    role: "owner",
    locationId: null,
    locationName: null,
    phone: "+380501234567",
    isActive: true,
    createdAt: new Date("2026-11-01"),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "andrii.lead@example.com",
    fullName: "Андрій Старший",
    role: "location_lead",
    locationId: "preview-lviv",
    locationName: "Львів",
    phone: null,
    isActive: true,
    createdAt: new Date("2026-11-02"),
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    email: null,
    fullName: "Марія Менеджер",
    role: "manager",
    locationId: null,
    locationName: null,
    phone: null,
    isActive: false,
    createdAt: new Date("2026-11-03"),
  },
];

const PREVIEW_SCREENS = [
  "orders",
  "profile",
  "users",
  "new-user",
  "user",
  ...CLIENT_PREVIEW_SCREENS,
  ...ORDER_PREVIEW_SCREENS,
  ...PRODUCTION_PREVIEW_SCREENS,
  ...CASH_PREVIEW_SCREENS,
  ...AUDIT_PREVIEW_SCREENS,
  "export",
] as const;

/**
 * Перегляд оболонки з вигаданим користувачем (`/ui-kit/shell/manager`).
 * Лише для розробки: у збірці сторінки немає. Посилання меню ведуть на справжні сторінки,
 * які вимагають входу. Параметр `?screen=` показує екрани з вигаданими даними: `orders`
 * (за замовчуванням), `profile`, `users`, `new-user`, `user`, а також екрани клієнтів і прайсу
 * (`clients`, `client` з `&tab=contacts|addresses|prices`, `prices`, `merge` тощо) і замовлень
 * (`order-list`, `order`, `new-order`, `edit-order` з `&status=draft|confirmed|in_production|packed|shipped|paid|closed|cancelled`)
 * і виробництва (`production`, `production-empty`, `production-wall`: режим «на стіні» лише для старшого локації)
 * і готівки (`cash`, `cash-empty`) і журналу змін (`audit`, `audit-empty`; на картках замовлення й клієнта
 * («Історія») лише для ролей з грошима) і «Експорт усього» (`export`; кнопки «Експорт у Excel» на списках
 * замовлень, клієнтів і готівки є лише ролям з правом на експорт).
 */
export default async function ShellPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ screen?: string; tab?: string; status?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { role } = await params;
  const { screen: requestedScreen, tab, status } = await searchParams;
  const screen = PREVIEW_SCREENS.find((item) => item === requestedScreen) ?? "orders";
  const knownRole = USER_ROLES.find((item): item is UserRole => item === role);
  if (!knownRole || knownRole === "driver") notFound();

  const bound = isLocationBound(knownRole);
  const user: AppUser = {
    id: "preview",
    email: "preview@example.com",
    fullName: "Тестовий користувач",
    role: knownRole,
    locationId: bound ? "preview-location" : null,
    locationName: bound ? "Київ" : null,
  };

  return (
    <AppShell
      user={user}
      locationFilter={buildLocationFilter(user, PREVIEW_LOCATIONS, null)}
      setLocation={previewSetLocation}
    >
      {screen === "profile" ? (
        <ProfileContent
          fullName={user.fullName}
          email={user.email}
          roleLabel={ROLE_LABELS[user.role]}
          locationLabel={user.locationName ?? "Усі локації"}
          canManageUsers
          canViewPrices
        />
      ) : screen === "users" ? (
        <UsersPageContent users={PREVIEW_USERS} />
      ) : screen === "new-user" ? (
        <NewUserContent locations={PREVIEW_LOCATIONS} action={previewFormAction} />
      ) : screen === "user" ? (
        <UserDetailContent
          user={PREVIEW_USERS[1]!}
          locations={PREVIEW_LOCATIONS}
          isSelf={false}
          isJustCreated
          updateAction={previewFormAction}
        />
      ) : (CLIENT_PREVIEW_SCREENS as readonly string[]).includes(screen) ? (
        <ClientsPreview
          role={knownRole}
          screen={screen as ClientPreviewScreen}
          tab={tab}
          tabBase={`/ui-kit/shell/${knownRole}?screen=${screen}`}
          action={previewFormAction}
          loadMore={previewLoadMore}
          previewCode={previewCode}
          findSimilar={previewSimilar}
        />
      ) : (ORDER_PREVIEW_SCREENS as readonly string[]).includes(screen) ? (
        <OrdersPreview
          role={knownRole}
          screen={screen as OrderPreviewScreen}
          status={status}
          action={previewFormAction}
          loadMore={previewLoadMoreOrders}
          formActions={{
            searchClients: previewSearchClients,
            clientAddresses: previewAddresses,
            pricing: previewPricing,
            findDuplicates: previewDuplicates,
            repeatLast: previewRepeat,
          }}
        />
      ) : (PRODUCTION_PREVIEW_SCREENS as readonly string[]).includes(screen) ? (
        <ProductionPreview
          role={knownRole}
          screen={screen as ProductionPreviewScreen}
          actions={{
            transition: previewFormAction,
            updateOrder: previewFormAction,
            markAllSeen: previewFormAction,
            openScreen: previewOpenScreen,
          }}
        />
      ) : (CASH_PREVIEW_SCREENS as readonly string[]).includes(screen) ? (
        <CashPreview
          role={knownRole}
          screen={screen as CashPreviewScreen}
          actions={{ record: previewFormAction, reverse: previewFormAction }}
        />
      ) : (AUDIT_PREVIEW_SCREENS as readonly string[]).includes(screen) ? (
        <AuditPreview screen={screen as AuditPreviewScreen} loadMore={previewLoadMoreAudit} />
      ) : screen === "export" ? (
        <ExportAllContent canSeeJournal={can(knownRole, "audit_log", "read")} />
      ) : (
        <ShellPreviewContent />
      )}
    </AppShell>
  );
}
