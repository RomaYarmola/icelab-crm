"use client";

import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { NAV_ITEMS, NavItem as NavItemData, NavItemId } from "@/constants/navigation";
import { isActivePath } from "@/utils/navigation";
import Popup from "../popup/Popup";
import NavItem from "./NavItem";
import { NAV_ID_ATTRIBUTE, useNavIndicator } from "./useNavIndicator";

interface BottomNavProps {
  /** Усі розділи ролі в порядку меню (без «Ще»). */
  items: NavItemData[];
  /**
   * Розділи, які на вузькому екрані (телефон, до `sm`) не вмістились у панель і лежать у «Ще»
   * (наприклад, «Оплати» власника). Від `sm` вони стоять у панелі, а «Ще» зникає.
   */
  phoneOverflowIds?: NavItemId[];
  /**
   * Вміст попапа «Ще» (профіль, розділи, вихід). Збирається на сервері й передається сюди готовим.
   * Якщо його немає, пункту «Ще» немає взагалі.
   */
  moreContent?: ReactNode;
}

/**
 * Нижня панель до `lg`. Телефон (до `sm`): до чотирьох розділів і «Ще» з профілем. Ширший екран
 * (від `sm`): усі розділи прямо в панелі, «Ще» немає (профіль і вихід у шапці, див. `UserMenu`).
 * На комп'ютері (від `lg`) замість неї бічна панель. Активний пункт позначає смужка зверху, що
 * плавно їде між пунктами.
 */
export default function BottomNav({ items, phoneOverflowIds = [], moreContent }: BottomNavProps) {
  const pathname = usePathname();
  // Запам'ятовуємо, на якій сторінці відкрили попап: після переходу на іншу він закривається сам,
  // без ефектів і ручного скидання стану.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const isMoreOpen = openedOnPath === pathname;
  const hasMore = moreContent !== undefined;

  // Активний пункт один: поки відкритий попап «Ще», активне воно, а не розділ під ним.
  const activeSectionId = items.find((item) => isActivePath(pathname, item.href))?.id ?? null;
  const isMoreActive = hasMore && (isMoreOpen || isActivePath(pathname, NAV_ITEMS.more.href));
  const activeId: NavItemId | null = isMoreOpen
    ? "more"
    : (activeSectionId ?? (isMoreActive ? "more" : null));

  const { listRef, indicatorRef, isPlaced } = useNavIndicator(activeId);

  return (
    <>
      <nav
        aria-label="Основне меню"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-grey-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div ref={listRef} className="relative mx-auto max-w-xl">
          <ul className="flex justify-evenly">
            {items.map((item) => (
              <li
                key={item.id}
                {...{ [NAV_ID_ATTRIBUTE]: item.id }}
                className={phoneOverflowIds.includes(item.id) ? "hidden sm:flex" : "flex"}
              >
                <NavItem
                  item={item}
                  variant="bar"
                  isActive={item.id === activeId}
                  showIndicator={!isPlaced}
                />
              </li>
            ))}
            {hasMore ? (
              <li {...{ [NAV_ID_ATTRIBUTE]: "more" }} className="flex sm:hidden">
                <NavItem
                  item={NAV_ITEMS.more}
                  variant="bar"
                  isActive={activeId === "more"}
                  isExpanded={isMoreOpen}
                  showIndicator={!isPlaced}
                  onClick={() => setOpenedOnPath(pathname)}
                />
              </li>
            ) : null}
          </ul>
          <span
            ref={indicatorRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 h-[3px] w-8 rounded-b-[3px] bg-blue opacity-0 transition"
          />
        </div>
      </nav>
      {hasMore ? (
        <Popup
          isOpen={isMoreOpen}
          onClose={() => setOpenedOnPath(null)}
          label="Меню «Ще»"
          // Ширший за типовий (11,25 rem): 13,125 rem = 210 px, щоб ім'я в профілі не обрізалось.
          className="w-[min(13.125rem,calc(100vw-1.5rem))]"
        >
          {moreContent}
        </Popup>
      ) : null}
    </>
  );
}
