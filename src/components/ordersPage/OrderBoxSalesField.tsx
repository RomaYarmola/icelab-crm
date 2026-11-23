"use client";

import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Text from "../shared/texts/Text";
import type { BoxSaleDraft } from "./orderFormTypes";

interface OrderBoxSalesFieldProps {
  sales: BoxSaleDraft[];
  onChange: (sales: BoxSaleDraft[]) => void;
  /** Бокси, які продаємо (без боксів клієнтів). */
  boxTypes: { id: string; name: string }[];
  /** Чинні ціни прайсу боксів: тип → ціна за штуку. */
  prices: Record<string, string>;
  disabled?: boolean;
}

/**
 * Продаж боксів у замовленні (D174): рядки «вид бокса, кількість, ціна за штуку». Ціна з прайсу
 * боксів підставляється сама, у полі її можна замінити. Замовлення може складатися лише з таких
 * рядків, без льоду. Рядки йдуть у приховане поле `boxSalesJson`.
 */
export default function OrderBoxSalesField({
  sales,
  onChange,
  boxTypes,
  prices,
  disabled,
}: OrderBoxSalesFieldProps) {
  const update = (key: number, patch: Partial<BoxSaleDraft>) =>
    onChange(sales.map((sale) => (sale.key === key ? { ...sale, ...patch } : sale)));
  const nextKey = () => sales.reduce((max, sale) => Math.max(max, sale.key), 0) + 1;

  const payload = sales
    .map((sale) => ({
      boxTypeId: sale.boxTypeId,
      qty: parseInt(sale.qty, 10),
      price: sale.price.trim() === "" ? null : sale.price.trim(),
    }))
    .filter((sale) => sale.boxTypeId && sale.qty > 0);

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="boxSalesJson" value={JSON.stringify(payload)} />
      {sales.map((sale, index) => {
        const auto = sale.boxTypeId ? prices[sale.boxTypeId] : undefined;
        return (
          <div
            key={sale.key}
            className="flex flex-col gap-3 rounded-field border border-grey-field p-3"
          >
            <CustomizedSelect
              name=""
              label={`Бокс на продаж ${index + 1}`}
              options={[
                { value: "", label: "Оберіть бокс" },
                ...boxTypes.map((type) => ({ value: type.id, label: type.name })),
              ]}
              value={sale.boxTypeId}
              disabled={disabled}
              onChange={(event) => update(sale.key, { boxTypeId: event.target.value })}
            />
            <CustomizedInput
              name=""
              label="Кількість"
              inputMode="numeric"
              autoComplete="off"
              value={sale.qty}
              disabled={disabled}
              onChange={(event) => update(sale.key, { qty: event.target.value })}
            />
            <CustomizedInput
              name=""
              label="Ціна за штуку, ₴"
              inputMode="decimal"
              autoComplete="off"
              value={sale.price}
              placeholder={auto ? String(Number(auto)) : ""}
              disabled={disabled}
              onChange={(event) => update(sale.key, { price: event.target.value })}
              hint={
                auto
                  ? "Порожнє поле: ціна за прайсом боксів."
                  : sale.boxTypeId
                    ? "У прайсі боксів для цього виду немає ціни: вкажіть її тут."
                    : undefined
              }
            />
            {!disabled ? (
              <MainButton
                variant="outline"
                size="sm"
                fullWidth={false}
                onClick={() => onChange(sales.filter((item) => item.key !== sale.key))}
              >
                Прибрати
              </MainButton>
            ) : null}
          </div>
        );
      })}
      {sales.length === 0 ? (
        <Text variant="muted">Тут можна продати бокси окремо від льоду.</Text>
      ) : null}
      {!disabled ? (
        <MainButton
          variant="outline"
          fullWidth={false}
          onClick={() =>
            onChange([...sales, { key: nextKey(), boxTypeId: "", qty: "1", price: "" }])
          }
        >
          {sales.length === 0 ? "Додати бокс на продаж" : "Додати ще бокс на продаж"}
        </MainButton>
      ) : null}
    </div>
  );
}
