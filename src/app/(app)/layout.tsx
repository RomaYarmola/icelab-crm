import AppShell from "@/components/shared/layout/AppShell";
import { requireUser } from "@/server/auth";
import { getLocationFilter } from "@/server/location-filter";

/**
 * Усе, що доступне лише після входу, лежить у цій групі маршрутів і отримує оболонку
 * застосунку (шапка, меню). Сторінки входу і помилок стоять поза групою.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locationFilter = await getLocationFilter();
  return (
    <AppShell user={user} locationFilter={locationFilter}>
      {children}
    </AppShell>
  );
}
