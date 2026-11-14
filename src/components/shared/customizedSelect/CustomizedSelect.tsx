"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { getFieldClassName } from "../customizedInput/fieldStyles";
import ChevronIcon from "../icons/ChevronIcon";
import TickIcon from "../icons/TickIcon";
import NavAction from "../navigation/NavAction";
import Popup from "../popup/Popup";

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomizedSelectProps {
  name: string;
  label: string;
  options: SelectOption[];
  /** Кероване значення. Без нього поле саме тримає вибір, початкове значення з `defaultValue`. */
  value?: string;
  defaultValue?: string;
  /** Викликається при виборі; значення в `event.target.value`, як у звичайного списку. */
  onChange?: (event: { target: { value: string } }) => void;
  required?: boolean;
  disabled?: boolean;
  /** Текст помилки під полем (українською). Якщо є, поле підсвічується. */
  error?: string;
  /** Підказка під полем, поки помилки немає. */
  hint?: string;
  /** Сховати підпис візуально (він лишається для екранних читалок). */
  isLabelHidden?: boolean;
  labelClassName?: string;
}

/**
 * Список вибору з підписом, підказкою і помилкою (кастомний): поле-кнопка, що відкриває попап зі
 * списком під собою тієї ж ширини (як вибір локації в шапці). Вигляд поля такий самий, як у
 * `CustomizedInput` (спільний `getFieldClassName`). У формі значення йде через приховане поле з
 * тим самим `name`, тож серверні дії читають його як раніше. Клавіатура: Enter, пробіл чи стрілка
 * вниз відкривають список, стрілки рухають по ньому, Esc закриває.
 */
export default function CustomizedSelect({
  name,
  label,
  options,
  value,
  defaultValue,
  onChange,
  required = false,
  disabled = false,
  error,
  hint,
  isLabelHidden = false,
  labelClassName = "",
}: CustomizedSelectProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initial = defaultValue ?? options[0]?.value ?? "";
  const [own, setOwn] = useState(initial);
  const [isOpen, setIsOpen] = useState(false);
  const current = value ?? own;
  const selected = options.find((option) => option.value === current);

  // Скидання форми (після дії React очищає поля) повертає вибір до початкового, як у звичайного списку.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setOwn(initial);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial, value]);

  // Відкритий список: фокус на вибраному пункті (або першому), щоб стрілки працювали одразу.
  useEffect(() => {
    if (!isOpen) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>("[role=option]");
    const target =
      listRef.current?.querySelector<HTMLElement>("[aria-selected=true]") ?? items?.[0];
    target?.focus();
  }, [isOpen]);

  function choose(next: string) {
    setIsOpen(false);
    triggerRef.current?.focus();
    if (next === current) return;
    setOwn(next);
    onChange?.({ target: { value: next } });
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = Math.min(index + 1, items.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <div className={cn("flex w-full flex-col gap-1.5", labelClassName)}>
      <span
        id={`${id}-label`}
        className={cn("text-body font-semibold text-navy", isLabelHidden && "sr-only")}
      >
        {label}
      </span>
      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={`${id}-label ${id}`}
          aria-describedby={hasMessage ? messageId : undefined}
          onClick={() => setIsOpen(true)}
          onKeyDown={onTriggerKeyDown}
          className={getFieldClassName({
            hasError: Boolean(error),
            className: "flex items-center pr-12 text-left",
          })}
        >
          <span className="truncate">{selected?.label ?? ""}</span>
        </button>
        <ChevronIcon
          className={cn(
            "pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-grey-text transition",
            isOpen && "rotate-180",
          )}
        />
        {/* Значення для форми. Невидиме, але не `readOnly`: тоді «обов'язкове» перевіряє сам браузер. */}
        <input
          ref={hiddenRef}
          type="text"
          name={name}
          value={current}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
        />
      </div>
      <Popup
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        label={label}
        anchorRef={triggerRef}
        matchAnchorWidth
      >
        <div
          ref={listRef}
          role="listbox"
          aria-labelledby={`${id}-label`}
          onKeyDown={onListKeyDown}
          className="flex flex-col gap-1"
        >
          {options.map((option) => {
            const isSelected = option.value === current;
            return (
              <NavAction
                key={option.value}
                role="option"
                aria-selected={isSelected}
                isActive={isSelected}
                // Розмір тексту як у полях форми (16 px), а не як у підписах нижнього меню.
                className="text-body"
                icon={
                  isSelected ? (
                    <TickIcon className="size-6 shrink-0" />
                  ) : (
                    <span className="size-6 shrink-0" aria-hidden="true" />
                  )
                }
                onClick={() => choose(option.value)}
              >
                {option.label}
              </NavAction>
            );
          })}
        </div>
      </Popup>
      {error ? (
        <p id={messageId} role="alert" className="text-body text-red-error">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-body text-grey-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
