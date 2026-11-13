"use client";

import type { DraftItem } from "./orderFormTypes";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Text from "../shared/texts/Text";

const KIND_OPTIONS = [
  { value: "delivery", label: "Доставка" },
  { value: "box_sale", label: "Продаж боксу" },
  { value: "other", label: "Інше" },
];

interface OrderFormItemsProps {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}

/**
 * Додаткові позиції нового замовлення (D55): «Доставка», «Продаж боксу», «Інше». Рядки можна
 * правити прямо тут, у тому числі ціну позицій, скопійованих «як минулого разу» (вони без цін).
 * Позицію «Лід» тут немає: її задають поля замовлення вище.
 */
export default function OrderFormItems({ items, onChange }: OrderFormItemsProps) {
  const update = (key: number, patch: Partial<DraftItem>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <Card key={item.key} className="flex flex-col gap-3">
          <CustomizedSelect
            name={`item-kind-${item.key}`}
            label={`Позиція ${index + 1}`}
            options={KIND_OPTIONS}
            value={item.kind}
            onChange={(event) =>
              update(item.key, { kind: event.target.value as DraftItem["kind"] })
            }
          />
          <CustomizedInput
            name={`item-title-${item.key}`}
            label="Назва"
            autoComplete="off"
            value={item.title}
            onChange={(event) => update(item.key, { title: event.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <CustomizedInput
              name={`item-qty-${item.key}`}
              label="Кількість"
              inputMode="decimal"
              autoComplete="off"
              value={item.qty}
              onChange={(event) => update(item.key, { qty: event.target.value })}
            />
            <CustomizedInput
              name={`item-price-${item.key}`}
              label="Ціна, ₴"
              inputMode="decimal"
              autoComplete="off"
              value={item.price}
              onChange={(event) => update(item.key, { price: event.target.value })}
            />
          </div>
          <MainButton
            variant="outline"
            size="sm"
            onClick={() => onChange(items.filter((other) => other.key !== item.key))}
          >
            Прибрати позицію
          </MainButton>
        </Card>
      ))}
      {items.length === 0 ? (
        <Text variant="muted">
          Додаткових позицій немає. Додайте платну доставку, продаж боксу чи інше, якщо вони є.
        </Text>
      ) : null}
      <MainButton
        variant="outline"
        onClick={() =>
          onChange([
            ...items,
            {
              key: Math.max(0, ...items.map((item) => item.key)) + 1,
              kind: "delivery",
              title: "",
              qty: "1",
              price: "",
            },
          ])
        }
      >
        Додати позицію
      </MainButton>
    </div>
  );
}
