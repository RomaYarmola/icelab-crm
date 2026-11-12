import { ReactNode } from "react";
import { setLocationAction } from "@/app/(app)/location-actions";
import { signOutAction } from "@/app/login/actions";
import { ALL_LOCATIONS_LABEL } from "@/constants/constants";
import { NAV_ITEMS } from "@/constants/navigation";
import type { AppUser } from "@/server/guards";
import type { LocationFilter } from "@/server/locations";
import { ROLE_LABELS } from "@/server/permissions";
import { getInitial } from "@/utils/initials";
import { accountNavItemsFor, extraNavItemsFor, navItemsFor } from "@/utils/navigation";
import Tag from "../chips/Tag";
import Container from "../container/Container";
import Header from "../header/Header";
import LocationSelect from "../header/LocationSelect";
import BottomNav from "../navigation/BottomNav";
import MoreMenu from "../navigation/MoreMenu";
import SideNav from "../navigation/SideNav";
import UserMenu from "../navigation/UserMenu";
import OfflineNotification from "../notification/OfflineNotification";

interface AppShellProps {
  user: AppUser;
  /** Вибір локації в шапці (див. `getLocationFilter`). */
  locationFilter: LocationFilter;
  /** Серверна дія збереження вибору локації. За замовчуванням справжня, для перегляду в каталозі своя. */
  setLocation?: typeof setLocationAction;
  children: ReactNode;
}

/**
 * Оболонка застосунку: шапка, меню за правами ролі й вміст. Телефон (до sm, PWA): нижня панель, її
 * «Ще» відкриває попап із профілем. Ширший екран (від sm до lg): усі розділи в нижній панелі без
 * «Ще», профіль і вихід у мітці користувача в шапці. Комп'ютер (веб, від lg): бічна панель. Пункти
 * меню беруться з матриці прав, див. utils/navigation.
 */
export default function AppShell({
  user,
  locationFilter,
  setLocation = setLocationAction,
  children,
}: AppShellProps) {
  const sections = navItemsFor(user.role, "side");
  const phoneOverflow = extraNavItemsFor(user.role);
  const accountItems = accountNavItemsFor(user.role);
  const locationLabel = user.locationName ?? ALL_LOCATIONS_LABEL;
  const roleLabel = ROLE_LABELS[user.role];

  const renderMoreMenu = (extraItems: typeof phoneOverflow) => (
    <MoreMenu
      fullName={user.fullName}
      email={user.email}
      roleLabel={roleLabel}
      locationLabel={locationLabel}
      extraItems={extraItems}
      signOutAction={signOutAction}
    />
  );

  return (
    <div className="min-h-dvh bg-white lg:pl-72">
      <SideNav
        items={sections}
        userName={user.fullName}
        userDescription={`${roleLabel} · ${locationLabel}`}
        signOutAction={signOutAction}
      />
      {/* Сторінка «Ще» не в меню комп'ютера, але має заголовок у шапці. */}
      <Header
        // «Користувачі» перед «Ще»: адреса /more/users теж починається з /more, а заголовок береться з першого збігу.
        items={[...sections, ...accountItems, NAV_ITEMS.more]}
        location={
          // Власник, менеджер і бухгалтер вибирають локацію, решта бачить лише підпис своєї.
          locationFilter.isSelectable ? (
            <LocationSelect
              options={locationFilter.options}
              selectedId={locationFilter.selectedId}
              allLabel={ALL_LOCATIONS_LABEL}
              action={setLocation}
            />
          ) : (
            <Tag variant="plain">{locationFilter.label}</Tag>
          )
        }
        userMenu={
          // Від sm усі розділи вже в нижній панелі, тож у меню користувача лише профіль і вихід.
          <UserMenu initial={getInitial(user.fullName)} label={`Профіль: ${user.fullName}`}>
            {renderMoreMenu(accountItems)}
          </UserMenu>
        }
      />
      <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10">
        <Container className="py-4 lg:py-8">{children}</Container>
      </main>
      <BottomNav
        items={sections}
        phoneOverflowIds={phoneOverflow.map((item) => item.id)}
        moreContent={renderMoreMenu([...phoneOverflow, ...accountItems])}
      />
      <OfflineNotification />
    </div>
  );
}
