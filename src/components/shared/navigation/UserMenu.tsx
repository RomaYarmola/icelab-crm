"use client";

import { ReactNode, useRef, useState } from "react";
import Popup from "../popup/Popup";

interface UserMenuProps {
  /** Перша літера імені для круглої мітки. */
  initial: string;
  /** Підпис кнопки для екранних читалок, наприклад «Профіль: Ірина Коваль». */
  label: string;
  /** Вміст попапа: хто увійшов і «Вийти» (збирається на сервері). */
  children: ReactNode;
}

/**
 * Кругла мітка користувача в шапці, що відкриває попап із профілем і «Вийти». Для ширшого екрана
 * (від `sm` до `lg`), де в нижній панелі вже немає пункту «Ще». Показується через клас обгортки
 * в `Header`; на комп'ютері користувач у бічній панелі.
 */
export default function UserMenu({ initial, label, children }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="flex size-11 items-center justify-center rounded-full border border-grey-border bg-grey-light text-body font-semibold text-navy transition active:scale-[98%] lg:hover:border-navy"
      >
        {initial}
      </button>
      <Popup
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        label={label}
        placement="top"
        anchorRef={triggerRef}
        // Ширший за типовий (11,25 rem): тут текст профілю 16 px, ім'я і e-mail довші.
        className="w-[min(16rem,calc(100vw-1.5rem))]"
      >
        {children}
      </Popup>
    </>
  );
}
