"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ClientListItem } from "@/server/client-views";
import { formatPhone } from "@/utils/phone";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import { getFieldClassName } from "../shared/customizedInput/fieldStyles";
import MainLink from "../shared/links/MainLink";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import type { PickedClient } from "./orderFormTypes";

/** Пауза після останньої літери, перед тим як шукати клієнта (як у пошуку списків). */
const PICKER_DEBOUNCE_MS = 300;

interface ClientPickerProps {
  value: PickedClient | null;
  onChange: (client: PickedClient | null) => void;
  searchClients: (query: string) => Promise<ClientListItem[]>;
  error?: string;
}

/**
 * Вибір клієнта в замовленні: пошук за кодом, назвою чи телефоном (від двох символів), список
 * результатів кнопками від 44 px. Вибраний клієнт показується карткою зі «Змінити». Нового клієнта
 * створюють у сусідній вкладці, щоб не втратити введене в замовленні.
 */
export default function ClientPicker({ value, onChange, searchClients, error }: ClientPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; items: ClientListItem[] } | null>(null);
  const request = useRef(0);

  const trimmed = query.trim();
  useEffect(() => {
    if (value || trimmed.length < 2) return;
    const current = ++request.current;
    const timer = setTimeout(() => {
      searchClients(trimmed).then((items) => {
        // Відповідь на застарілий запит (текст уже змінили) відкидаємо.
        if (current === request.current) setResult({ query: trimmed, items });
      });
    }, PICKER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, value, searchClients]);

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <Text variant="label">Клієнт</Text>
        <input type="hidden" name="clientId" value={value.id} />
        <Card className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SubTitle className="break-words">{value.name}</SubTitle>
            <Text variant="muted">{value.code}</Text>
          </div>
          <MainButton
            variant="outline"
            size="sm"
            fullWidth={false}
            onClick={() => {
              onChange(null);
              setQuery("");
              setResult(null);
            }}
          >
            Змінити
          </MainButton>
        </Card>
      </div>
    );
  }

  const items = result && result.query === trimmed ? result.items : [];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body font-semibold text-navy">
        Клієнт
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Код, назва або телефон клієнта"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={getFieldClassName({ hasError: Boolean(error) })}
      />
      {error ? (
        <p role="alert" className="text-body text-red-error">
          {error}
        </p>
      ) : null}
      {trimmed.length >= 2 && result && result.query === trimmed && items.length === 0 ? (
        <Text variant="muted">Нікого не знайдено. Спробуйте інший код чи телефон.</Text>
      ) : null}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => onChange({ id: client.id, code: client.code, name: client.name })}
                className="flex min-h-11 w-full flex-col gap-0.5 rounded-field border border-grey-border bg-grey-light px-4 py-2 text-left transition active:scale-[99%] lg:hover:border-grey-field"
              >
                <span className="text-body font-semibold text-navy">{client.name}</span>
                <span className="text-body text-grey-text">
                  {client.code}
                  {client.primaryPhone ? ` · ${formatPhone(client.primaryPhone)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Text variant="muted">
        Немає в списку?{" "}
        <MainLink href="/clients/new" isExternal>
          Створити нового клієнта
        </MainLink>{" "}
        (відкриється в новій вкладці).
      </Text>
    </div>
  );
}
