"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NavItem as NavItemData } from "@/constants/navigation";
import { cn } from "@/utils/cn";
import { isActivePath } from "@/utils/navigation";
import LogoutIcon from "../icons/LogoutIcon";
import Text from "../texts/Text";
import NavAction from "./NavAction";
import NavItem from "./NavItem";

interface MoreMenuProps {
  fullName: string;
  email: string | null;
  roleLabel: string;
  locationLabel: string;
  /** Розділи, які не вмістились у нижню панель (наприклад, «Оплати» власника). */
  extraItems: NavItemData[];
  signOutAction: () => Promise<void>;
}

/**
 * Вміст меню «Ще»: хто увійшов, розділи, яких немає в нижній панелі, і вихід. Підписи пунктів
 * мають той самий розмір і кольори, що й нижня панель (NavItem, NavAction, `variant="popup"`).
 * Показується в попапі «Ще» на телефоні (BottomNav), у попапі мітки користувача в шапці на ширшому
 * екрані (UserMenu, без розділів) і на сторінці `/more` (прямий перехід).
 */
export default function MoreMenu({
  fullName,
  email,
  roleLabel,
  locationLabel,
  extraItems,
  signOutAction,
}: MoreMenuProps) {
  const pathname = usePathname();

  return (
    <div className="flex w-full flex-col gap-1">
      {/* Профіль веде на сторінку «Ще»: там дані користувача і зміна пароля. */}
      <Link
        href={NAV_ITEMS.more.href}
        aria-label={`Профіль: ${fullName}`}
        className={cn(
          "flex min-w-0 flex-col rounded-field px-4 py-2 transition",
          pathname === NAV_ITEMS.more.href ? "bg-grey-light" : "lg:hover:bg-grey-light",
        )}
      >
        {/* На телефоні (до sm) текст профілю дрібніший, від sm звичайного розміру. */}
        <Text variant="label" className="truncate text-caption sm:text-body">
          {fullName}
        </Text>
        <Text variant="muted" className="truncate text-nav sm:text-body">
          {roleLabel} · {locationLabel}
        </Text>
        {email ? (
          <Text variant="muted" className="truncate text-nav sm:text-body">
            {email}
          </Text>
        ) : null}
      </Link>

      <hr className="my-1 border-grey-border" />

      {extraItems.map((item) => (
        <NavItem
          key={item.id}
          item={item}
          variant="popup"
          isActive={isActivePath(pathname, item.href)}
        />
      ))}

      <form action={signOutAction}>
        <NavAction type="submit" icon={<LogoutIcon className="size-6 shrink-0" />}>
          Вийти
        </NavAction>
      </form>
    </div>
  );
}
