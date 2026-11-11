"use client";

import { ReactNode, RefObject, useEffect, useRef } from "react";
import { cn } from "@/utils/cn";

interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  /** Назва вікна для екранних читалок (видимого заголовка немає). */
  label: string;
  children: ReactNode;
  /**
   * `bottom`: правий нижній край над нижньою панеллю (меню «Ще» на телефоні). `top`: правий верхній
   * край під шапкою (меню користувача на ширшому екрані).
   */
  placement?: "bottom" | "top";
  /**
   * Кнопка, що відкриває попап. Якщо передано, попап при відкритті стає прямо під нею (на
   * `ANCHOR_GAP` нижче, правий край до правого краю кнопки), а не на типовому місці `placement`.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/** Відступ між кнопкою і попапом під нею, px. */
const ANCHOR_GAP = 8;

const PLACEMENT_CLASS_NAMES = {
  bottom:
    "animate-popup-in top-auto right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-auto",
  // Правий відступ збігається з відступом шапки (px-4, на комп'ютері px-15).
  top: "animate-popup-in-top top-[calc(4.5rem+env(safe-area-inset-top))] right-4 bottom-auto left-auto lg:right-15",
} as const;

/**
 * Компактний попап, прикріплений до правого краю: знизу над нижньою панеллю телефона (меню «Ще»)
 * або зверху під шапкою (меню користувача, вибір локації). Не на всю ширину: типово до 11,25 rem = 180 px (вибір локації), «Ще» і мітка користувача задають свою через `className`. Побудований на нативному
 * `<dialog>`: фокус тримається всередині, Esc закриває, решта сторінки недоступна. Закривається
 * також кліком поза вікном. Поява йде тим самим ефектом плавності, що й решта інтерфейсу
 * (`--transition-duration`).
 */
export default function Popup({
  isOpen,
  onClose,
  label,
  children,
  placement = "bottom",
  anchorRef,
  className,
}: PopupProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      // Положення рахуємо в момент відкриття за справжнім місцем кнопки, тож воно не залежить від
      // висоти шапки чи розміру екрана. Інлайн-стиль сильніший за клас `placement`.
      const anchor = anchorRef?.current?.getBoundingClientRect();
      if (anchor) {
        dialog.style.top = `${anchor.bottom + ANCHOR_GAP}px`;
        // clientWidth без смуги прокрутки: саме від неї рахує `right` фіксований елемент.
        dialog.style.right = `${document.documentElement.clientWidth - anchor.right}px`;
      } else {
        dialog.style.removeProperty("top");
        dialog.style.removeProperty("right");
      }
      dialog.showModal();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen, anchorRef]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      // Native-подія close приходить і після Esc, тож стан батька завжди збігається з вікном.
      onClose={onClose}
      // Відступи в обгортці, а не в dialog: клік по самому dialog це клік поза вікном.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        "fixed m-0 max-h-[calc(100dvh-8rem)] w-[min(11.25rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-card border border-grey-border bg-white p-0 text-navy shadow-floating backdrop:bg-navy/20",
        PLACEMENT_CLASS_NAMES[placement],
        className,
      )}
    >
      <div className="p-2">{children}</div>
    </dialog>
  );
}
