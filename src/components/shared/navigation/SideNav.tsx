"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NavItem as NavItemData } from "@/constants/navigation";
import { cn } from "@/utils/cn";
import { isActivePath } from "@/utils/navigation";
import MainButton from "../buttons/MainButton";
import LogoutIcon from "../icons/LogoutIcon";
import Logo from "../logo/Logo";
import Text from "../texts/Text";
import NavItem from "./NavItem";

interface SideNavProps {
  items: NavItemData[];
  userName: string;
  /** Роль і локація: «Менеджер · Київ». */
  userDescription: string;
  signOutAction: () => Promise<void>;
}

/** Бічна панель комп'ютера (від lg): логотип, розділи, користувач і «Вийти». */
export default function SideNav({ items, userName, userDescription, signOutAction }: SideNavProps) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col gap-6 border-r border-grey-border bg-white p-6 lg:flex">
      <Logo priority className="mx-auto w-32" />
      {/* Коли пунктів більше, ніж вміщається по висоті, меню гортається тонкою смужкою збоку. */}
      <nav
        aria-label="Основне меню"
        className="-mr-3 min-h-0 flex-1 overflow-y-auto pr-3 [scrollbar-color:var(--color-grey-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-grey-border [&::-webkit-scrollbar-track]:bg-transparent"
      >
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              {/* Перед «Журналом змін» починається службова частина меню: відділяємо її рискою. */}
              {item.id === "audit" ? <hr className="my-2 border-grey-border" /> : null}
              <NavItem item={item} isActive={isActivePath(pathname, item.href)} variant="side" />
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-3 border-t border-grey-border pt-4">
        {/* Блок користувача веде на сторінку профілю (пункту «Ще» в бічній панелі немає). */}
        <Link
          href={NAV_ITEMS.more.href}
          aria-label={`Профіль: ${userName}`}
          aria-current={pathname === NAV_ITEMS.more.href ? "page" : undefined}
          className={cn(
            "-mx-2 flex flex-col rounded-field px-2 py-1 transition",
            pathname === NAV_ITEMS.more.href ? "bg-grey-light" : "lg:hover:bg-grey-light",
          )}
        >
          <Text variant="label">{userName}</Text>
          <Text variant="muted">{userDescription}</Text>
        </Link>
        <form action={signOutAction}>
          <MainButton
            type="submit"
            variant="outline"
            size="sm"
            icon={<LogoutIcon className="size-5" />}
          >
            Вийти
          </MainButton>
        </form>
      </div>
    </aside>
  );
}
