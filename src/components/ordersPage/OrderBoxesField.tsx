"use client";

import Link from "next/link";
import type { ClientOwnBoxOption } from "@/server/order-form";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Text from "../shared/texts/Text";
import type { BoxLineDraft } from "./orderFormTypes";

interface OrderBoxesFieldProps {
  lines: BoxLineDraft[];
  onChange: (lines: BoxLineDraft[]) => void;
  /** Наші типи тари (без загального «Бокс клієнта»). */
  boxTypes: { id: string; name: string }[];
  /** Бокси вибраного клієнта. */
  ownBoxes: ClientOwnBoxOption[];
  clientId: string;
  disabled?: boolean;
}

const variantOf = (line: BoxLineDraft) =>
  line.clientOwnBoxId ? `o:${line.clientOwnBoxId}` : line.boxTypeId ? `t:${line.boxTypeId}` : "";

const OWNER_OPTIONS = [
  { value: "ours", label: "Наш бокс" },
  { value: "client", label: "Бокс клієнта" },
];

/**
 * Рядки тари замовлення (Роман, 20.11.2026): для кожного рядка спершу обирають, чий бокс (наш чи
 * клієнта), потім його вид і кількість. Так можна 2 × Міні 9 л, 1 × mini і 1 × довгий, а також
 * 1 бокс клієнта і 1 наш. Рядки йдуть у приховане поле `boxesJson`.
 */
export default function OrderBoxesField({
  lines,
  onChange,
  boxTypes,
  ownBoxes,
  clientId,
  disabled,
}: OrderBoxesFieldProps) {
  const update = (key: number, patch: Partial<BoxLineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const nextKey = () => lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;

  const payload = lines
    .map((line) => ({
      boxTypeId: line.boxTypeId || null,
      clientOwnBoxId: line.clientOwnBoxId || null,
      count: parseInt(line.count, 10),
    }))
    .filter((line) => (line.boxTypeId || line.clientOwnBoxId) && line.count > 0);
  const total = payload.reduce((sum, line) => sum + line.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="boxesJson" value={JSON.stringify(payload)} />
      {lines.map((line, index) => {
        const isClient = line.owner === "client";
        const variants = isClient
          ? ownBoxes.map((box) => ({ value: `o:${box.id}`, label: box.name }))
          : boxTypes.map((type) => ({ value: `t:${type.id}`, label: type.name }));
        return (
          <div
            key={line.key}
            className="flex flex-col gap-3 rounded-field border border-grey-field p-3"
          >
            <CustomizedSelect
              name=""
              label={`Бокс ${index + 1}: чий`}
              options={OWNER_OPTIONS}
              value={line.owner}
              disabled={disabled}
              onChange={(event) =>
                // Інший власник: вид бокса інший, тож вибір скидаємо.
                update(line.key, {
                  owner: event.target.value === "client" ? "client" : "ours",
                  boxTypeId: "",
                  clientOwnBoxId: "",
                })
              }
            />
            {isClient && ownBoxes.length === 0 ? (
              <Text variant="muted">
                {clientId ? (
                  <>
                    У клієнта ще немає боксів.{" "}
                    <Link
                      href={`/clients/${clientId}?tab=own_boxes`}
                      target="_blank"
                      className="font-semibold text-navy underline"
                    >
                      Додайте їх у картці клієнта
                    </Link>
                    , вкладка «Бокси клієнта», і оберіть клієнта знову.
                  </>
                ) : (
                  "Спочатку оберіть клієнта, щоб вибрати його бокси."
                )}
              </Text>
            ) : (
              <CustomizedSelect
                name=""
                label="Вид бокса"
                options={[{ value: "", label: "Оберіть бокс" }, ...variants]}
                value={variantOf(line)}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.target.value;
                  update(line.key, {
                    boxTypeId: value.startsWith("t:") ? value.slice(2) : "",
                    clientOwnBoxId: value.startsWith("o:") ? value.slice(2) : "",
                  });
                }}
              />
            )}
            <CustomizedInput
              name=""
              label="Кількість"
              inputMode="numeric"
              autoComplete="off"
              value={line.count}
              disabled={disabled}
              onChange={(event) => update(line.key, { count: event.target.value })}
            />
            {!disabled ? (
              <MainButton
                variant="outline"
                size="sm"
                fullWidth={false}
                onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
              >
                Прибрати
              </MainButton>
            ) : null}
          </div>
        );
      })}
      {total > 0 ? <Text variant="muted">Разом боксів: {total}</Text> : null}
      {!disabled ? (
        <MainButton
          variant="outline"
          fullWidth={false}
          onClick={() =>
            onChange([
              ...lines,
              { key: nextKey(), owner: "ours", boxTypeId: "", clientOwnBoxId: "", count: "1" },
            ])
          }
        >
          {lines.length === 0 ? "Додати бокс" : "Додати ще бокс"}
        </MainButton>
      ) : null}
    </div>
  );
}
