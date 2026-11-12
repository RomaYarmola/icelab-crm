"use client";

import { useEffect, useId, useRef, useState } from "react";
import IconButton from "../buttons/IconButton";
import { getFieldClassName } from "../customizedInput/fieldStyles";
import CloseIcon from "../icons/CloseIcon";
import LoaderIcon from "../icons/LoaderIcon";
import SearchIcon from "../icons/SearchIcon";
import { useUrlParam } from "./useUrlParam";

/** Пауза після останньої літери, перед тим як шукати (D47). */
export const SEARCH_DEBOUNCE_MS = 300;

interface SearchFieldProps {
  /** Підпис для екранних читалок (видимого підпису немає: поле впізнається за лупою). */
  label: string;
  placeholder?: string;
  /** Назва параметра адреси, де лежить пошуковий запит. */
  paramName?: string;
}

/**
 * Рядок пошуку зі станом в адресі сторінки. Пошук запускається через 300 мс після останньої літери
 * або одразу за Enter, поки сервер готує список, у полі крутиться індикатор. Висота від 50 px,
 * шрифт від 16 px (як у всіх полів).
 *
 * Поки користувач друкує, у полі його текст (`draft`), а не адреса: інакше повільна відповідь
 * сервера стерла б щойно набрані літери. Коли нічого не чекає, поле знову показує адресу, тож
 * перехід за посиланням чи «Назад» змінює й текст.
 */
export default function SearchField({ label, placeholder, paramName = "q" }: SearchFieldProps) {
  const id = useId();
  const { urlValue, isPending, push } = useUrlParam(paramName);
  const [draft, setDraft] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Нічого не чекає, а текст у полі відрізняється від адреси: адреса змінилась ззовні.
  if (draft !== null && !isWaiting && !isPending && draft.trim() !== urlValue) setDraft(null);
  const shown = draft ?? urlValue;

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(text: string) {
    clearTimeout(timer.current);
    setIsWaiting(false);
    push(text.trim());
  }

  function change(text: string) {
    setDraft(text);
    setIsWaiting(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(text), SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-grey-text" />
      <input
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            search(event.currentTarget.value);
          }
        }}
        className={getFieldClassName({
          className:
            "pr-12 pl-11 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
        })}
      />
      {isPending || isWaiting ? (
        <span
          role="status"
          aria-live="polite"
          className="absolute top-1/2 right-3.5 -translate-y-1/2 text-blue"
        >
          <LoaderIcon className="size-5" />
          <span className="sr-only">Шукаємо</span>
        </span>
      ) : shown !== "" ? (
        <IconButton
          label="Очистити пошук"
          onClick={() => {
            setDraft("");
            search("");
          }}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-grey-text lg:hover:text-navy"
        >
          <CloseIcon className="size-5" />
        </IconButton>
      ) : null}
    </div>
  );
}
