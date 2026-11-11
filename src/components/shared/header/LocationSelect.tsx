"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { cn } from "@/utils/cn";
import ChevronIcon from "../icons/ChevronIcon";
import TickIcon from "../icons/TickIcon";
import NavAction from "../navigation/NavAction";
import Popup from "../popup/Popup";

export interface LocationSelectOption {
  id: string;
  name: string;
}

interface LocationSelectProps {
  options: LocationSelectOption[];
  /** Вибрана локація або `null` («усі»). */
  selectedId: string | null;
  /** Підпис варіанта «усі», наприклад «Усі локації». */
  allLabel: string;
  /** Серверна дія, що зберігає вибір (id або `null`) і повертає `{ ok }`. */
  action: (locationId: string | null) => Promise<{ ok: boolean }>;
}

/**
 * Вибір локації в шапці для ролей, що бачать усі локації: «Усі локації», «Київ», «Львів».
 * Вигляд як у `Tag`, але це кнопка: відкриває попап під шапкою зі списком. Вибір зберігає серверна
 * дія (cookie), після чого сторінка перечитується вже з новою локацією. Значення в шапці
 * змінюється одразу, а якщо збереження не вдалось, повертається назад.
 */
export default function LocationSelect({
  options,
  selectedId,
  allLabel,
  action,
}: LocationSelectProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(selectedId);
  const [seen, setSeen] = useState(selectedId);

  // Сервер передав інше значення (наприклад, після перечитування сторінки): беремо його.
  if (seen !== selectedId) {
    setSeen(selectedId);
    setCurrent(selectedId);
  }

  const currentLabel = options.find((option) => option.id === current)?.name ?? allLabel;
  const choices: { id: string | null; name: string }[] = [{ id: null, name: allLabel }, ...options];

  function choose(id: string | null) {
    setIsOpen(false);
    if (id === current) return;
    const previous = current;
    setCurrent(id);
    startTransition(async () => {
      const result = await action(id);
      if (!result.ok) {
        setCurrent(previous);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-busy={isPending}
        aria-label={`Локація: ${currentLabel}. Змінити`}
        onClick={() => setIsOpen(true)}
        className={cn(
          // after розширює зону натискання до 44 px, поки сама «пігулка» на телефоні компактна.
          "relative inline-flex min-h-8 items-center gap-1 rounded-full border border-grey-field pr-2 pl-3 text-caption font-semibold whitespace-nowrap text-navy transition after:absolute after:inset-x-0 after:-inset-y-2 active:scale-[98%] lg:min-h-11 lg:pr-3 lg:pl-4 lg:after:inset-y-0 lg:hover:border-navy",
          isPending && "opacity-60",
        )}
      >
        {currentLabel}
        <ChevronIcon
          className={cn("size-4 shrink-0 transition lg:size-5", isOpen && "rotate-180")}
        />
      </button>
      <Popup
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        label="Вибір локації"
        placement="top"
        anchorRef={triggerRef}
      >
        <div role="group" aria-label="Локація" className="flex flex-col gap-1">
          {choices.map((choice) => {
            const isSelected = choice.id === current;
            return (
              <NavAction
                key={choice.id ?? "all"}
                aria-pressed={isSelected}
                isActive={isSelected}
                // Розмір тексту як у звичайному тексті (16 px), а не як у підписах нижнього меню.
                className="text-body"
                icon={
                  isSelected ? (
                    <TickIcon className="size-6 shrink-0" />
                  ) : (
                    <span className="size-6 shrink-0" aria-hidden="true" />
                  )
                }
                onClick={() => choose(choice.id)}
              >
                {choice.name}
              </NavAction>
            );
          })}
        </div>
      </Popup>
    </>
  );
}
