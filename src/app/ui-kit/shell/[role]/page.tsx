import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShellPreviewContent from "@/components/uiKitPage/ShellPreviewContent";
import AppShell from "@/components/shared/layout/AppShell";
import type { AppUser } from "@/server/guards";
import { buildLocationFilter, type LocationOption } from "@/server/locations";
import { isLocationBound, USER_ROLES, type UserRole } from "@/server/permissions";

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

/**
 * Перегляд оболонки для вибраної ролі з вигаданим користувачем (`/ui-kit/shell/manager`).
 * Лише для розробки: у збірці сторінки немає. Посилання меню ведуть на справжні сторінки,
 * які вимагають входу.
 */
export default async function ShellPreviewPage({ params }: { params: Promise<{ role: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const { role } = await params;
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
      <ShellPreviewContent />
    </AppShell>
  );
}
