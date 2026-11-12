import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProfileContent from "@/components/profilePage/ProfileContent";
import AppShell from "@/components/shared/layout/AppShell";
import NewUserContent from "@/components/usersPage/NewUserContent";
import ShellPreviewContent from "@/components/uiKitPage/ShellPreviewContent";
import UserDetailContent from "@/components/usersPage/UserDetailContent";
import UsersPageContent from "@/components/usersPage/UsersPageContent";
import type { AppUser } from "@/server/guards";
import { buildLocationFilter, type LocationOption } from "@/server/locations";
import { isLocationBound, ROLE_LABELS, USER_ROLES, type UserRole } from "@/server/permissions";
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

const PREVIEW_SCREENS = ["orders", "profile", "users", "new-user", "user"] as const;

/**
 * Перегляд оболонки з вигаданим користувачем (`/ui-kit/shell/manager`).
 * Лише для розробки: у збірці сторінки немає. Посилання меню ведуть на справжні сторінки,
 * які вимагають входу. Параметр `?screen=` показує екрани з вигаданими даними: `orders`
 * (за замовчуванням), `profile`, `users`, `new-user`, `user`.
 */
export default async function ShellPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { role } = await params;
  const { screen: requestedScreen } = await searchParams;
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
      ) : (
        <ShellPreviewContent />
      )}
    </AppShell>
  );
}
