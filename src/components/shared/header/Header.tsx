"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { APP_NAME } from "@/constants/constants";
import { NavItem } from "@/constants/navigation";
import { isActivePath } from "@/utils/navigation";
import Logo from "../logo/Logo";

interface HeaderProps {
  /** Усі розділи користувача: за ними підбираємо заголовок поточної сторінки. */
  items: NavItem[];
  /** Локація в шапці: підпис (`Tag`) або вибір (`LocationSelect`), залежно від ролі. */
  location: ReactNode;
  /** Мітка користувача з меню (`UserMenu`): видно лише від `sm` до `lg`, де в нижній панелі немає «Ще». */
  userMenu?: ReactNode;
}

/** Верхній рядок: знак IceLab і назва розділу, справа локація і (на ширшому екрані) мітка користувача. */
export default function Header({ items, location, userMenu }: HeaderProps) {
  const pathname = usePathname();
  const current = items.find((item) => isActivePath(pathname, item.href));

  return (
    <header className="sticky top-0 z-30 border-b border-grey-border bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-15">
        <div className="flex min-w-0 items-center gap-3">
          <Logo variant="mark" priority className="lg:hidden" />
          <h1 className="truncate text-h2 text-navy">{current?.label ?? APP_NAME}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {location}
          {userMenu ? <div className="hidden sm:block lg:hidden">{userMenu}</div> : null}
        </div>
      </div>
    </header>
  );
}
