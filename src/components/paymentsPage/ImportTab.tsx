"use client";

import { useRef, useState, useTransition } from "react";
import type { ColumnMapping } from "@/server/statement-file";
import type { ImportPreview, ImportResult } from "@/server/statement-import";
import { formatDateTime } from "@/utils/formatDate";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import type { PaymentActions } from "./paymentTypes";

const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  date: "Дата й час",
  amount: "Сума",
  description: "Опис операції",
  counter: "Платник",
  comment: "Коментар",
};
const REQUIRED: (keyof ColumnMapping)[] = ["date", "amount"];

/**
 * Імпорт файла виписки (ТЗ 6.10): запасний шлях, коли API недоступний. Вибрати файл CSV чи XLSX,
 * перевірити колонки й побачити, скільки буде нових платежів і дублів, потім імпортувати. Повторне
 * завантаження того самого файла дублів не створює.
 */
export default function ImportTab({ actions }: { actions: PaymentActions }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const build = (withMapping: ColumnMapping | null): FormData | null => {
    const file = fileRef.current?.files?.[0];
    if (!file) return null;
    const data = new FormData();
    data.set("file", file);
    if (withMapping) data.set("mapping", JSON.stringify(withMapping));
    return data;
  };

  const runPreview = (withMapping: ColumnMapping | null) => {
    const data = build(withMapping);
    if (!data) return;
    setResult(null);
    startTransition(async () => {
      const response = await actions.importPreview(data);
      if (response.ok) {
        setError(null);
        setPreview(response.data);
        setMapping(response.data.mapping);
      } else {
        setPreview(null);
        setError(response.error);
      }
    });
  };

  const runImport = () => {
    const data = build(mapping);
    if (!data || !mapping) return;
    startTransition(async () => {
      const response = await actions.importCommit(data);
      if (response.ok) {
        setError(null);
        setResult(response.data);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } else setError(response.error);
    });
  };

  const changeField = (field: keyof ColumnMapping, value: string) => {
    if (!mapping) return;
    const next = { ...mapping, [field]: value === "" ? null : value };
    setMapping(next);
    runPreview(next);
  };

  const canImport = Boolean(preview && mapping?.date && mapping?.amount && preview.fresh > 0);

  return (
    <section aria-labelledby="payments-import" className="flex max-w-2xl flex-col gap-4">
      <SectionTitle id="payments-import">Імпорт виписки з файла</SectionTitle>
      <Text variant="muted">
        Запасний шлях, коли банк недоступний чи треба догнати період. Завантажте файл CSV чи XLSX з
        програми monobank, перевірте колонки й імпортуйте. Імпортуємо лише надходження, дублі
        пропускаємо, повторне завантаження того самого файла нічого не додає.
      </Text>
      <label className="flex flex-col gap-2 text-body">
        <span className="font-semibold text-navy">Файл виписки (до 3 МБ)</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.xlsx"
          onChange={() => runPreview(null)}
          className="min-h-11 rounded-card border border-grey-field bg-white p-2 text-body"
        />
      </label>

      {error ? <Notification variant="error">{error}</Notification> : null}
      {result ? (
        <Notification variant="success">
          Імпортовано платежів: {result.inserted}. Дублів пропущено: {result.duplicates}
          {result.errors > 0 ? `, рядків з помилками: ${result.errors}` : ""}. Автоматично
          зіставлено: {result.matched}. Решту дивіться у вкладці «Нерозпізнані».
        </Notification>
      ) : null}

      {preview && mapping ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-1">
            <Text className="font-semibold">У файлі рядків: {preview.total}</Text>
            <Text>Нових платежів: {preview.fresh}</Text>
            <Text>Уже є в базі (дублі): {preview.duplicates}</Text>
            <Text variant="muted">Витрати й нульові суми пропущено: {preview.skippedOutgoing}</Text>
            {preview.fromTemplate ? (
              <Text variant="muted">Колонки взято зі збереженого шаблону.</Text>
            ) : null}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(FIELD_LABELS) as (keyof ColumnMapping)[]).map((field) => (
              <CustomizedSelect
                key={field}
                name={field}
                label={FIELD_LABELS[field]}
                value={mapping[field] ?? ""}
                onChange={(event) => changeField(field, event.target.value)}
                options={[
                  ...(REQUIRED.includes(field) ? [] : [{ value: "", label: "Не використовувати" }]),
                  ...preview.headers.map((header) => ({
                    value: header,
                    label: header || "(без назви)",
                  })),
                ]}
                required={REQUIRED.includes(field)}
              />
            ))}
          </div>

          {preview.errors.length > 0 ? (
            <Notification variant="warning" title="Деякі рядки не вдалося прочитати">
              {preview.errors.map((item) => `рядок ${item.line}: ${item.message}`).join("; ")}. Їх
              буде пропущено.
            </Notification>
          ) : null}

          {preview.sample.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Text variant="label">Перші нові платежі:</Text>
              <ul className="flex flex-col gap-2">
                {preview.sample.map((row) => (
                  <Card as="li" key={row.line} className="flex flex-col gap-0.5">
                    <Text className="font-semibold">
                      {formatMoney(parseDecimal(row.amount))} · {formatDateTime(row.occurredAt)}
                    </Text>
                    <Text variant="muted" className="break-words">
                      {[row.counterName, row.description].filter(Boolean).join(" · ") ||
                        "Без опису"}
                    </Text>
                  </Card>
                ))}
              </ul>
            </div>
          ) : null}

          <MainButton
            type="button"
            onClick={runImport}
            isLoading={isPending}
            loadingText="Імпортуємо…"
            disabled={!canImport}
          >
            Імпортувати {preview.fresh > 0 ? `(${preview.fresh})` : ""}
          </MainButton>
        </div>
      ) : isPending ? (
        <Text variant="muted">Читаємо файл…</Text>
      ) : null}
    </section>
  );
}
