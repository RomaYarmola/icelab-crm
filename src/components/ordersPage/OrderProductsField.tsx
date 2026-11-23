"use client";

import type { OrderProductOption } from "@/server/order-products";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Text from "../shared/texts/Text";
import type { ProductLineDraft } from "./orderFormTypes";

interface OrderProductsFieldProps {
  lines: ProductLineDraft[];
  onChange: (lines: ProductLineDraft[]) => void;
  /** Товари без типів, які можна додати (рідкий азот та майбутні). */
  products: OrderProductOption[];
  disabled?: boolean;
}

/**
 * Інші товари в замовленні (D174, D176): рядки «товар, кількість, ціна за одиницю». Ціна з прайсу
 * товару підставляється сама, у полі її можна замінити. Рядки йдуть у приховане поле
 * `productsJson`.
 */
export default function OrderProductsField({
  lines,
  onChange,
  products,
  disabled,
}: OrderProductsFieldProps) {
  const update = (key: number, patch: Partial<ProductLineDraft>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const nextKey = () => lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;

  const payload = lines
    .map((line) => ({
      code: line.code,
      qty: line.qty.trim(),
      price: line.price.trim() === "" ? null : line.price.trim(),
    }))
    .filter((line) => line.code && Number(line.qty.replace(",", ".")) > 0);

  if (products.length === 0 && lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="productsJson" value={JSON.stringify(payload)} />
      {lines.map((line, index) => {
        const product = products.find((candidate) => candidate.code === line.code);
        return (
          <div
            key={line.key}
            className="flex flex-col gap-3 rounded-field border border-grey-field p-3"
          >
            <CustomizedSelect
              name=""
              label={`Товар ${index + 1}`}
              options={[
                { value: "", label: "Оберіть товар" },
                ...products.map((item) => ({ value: item.code, label: item.name })),
              ]}
              value={line.code}
              disabled={disabled}
              onChange={(event) => update(line.key, { code: event.target.value })}
            />
            <CustomizedInput
              name=""
              label={`Кількість${product ? `, ${product.unit}` : ""}`}
              inputMode="decimal"
              autoComplete="off"
              value={line.qty}
              disabled={disabled}
              onChange={(event) => update(line.key, { qty: event.target.value })}
              hint={
                product?.allowedDeliveryMethods
                  ? "Цей товар поштою не відправляємо: лише самовивіз чи власна доставка."
                  : undefined
              }
            />
            <CustomizedInput
              name=""
              label={`Ціна за ${product?.unit ?? "одиницю"}, ₴`}
              inputMode="decimal"
              autoComplete="off"
              value={line.price}
              placeholder={product?.price ? String(Number(product.price)) : ""}
              disabled={disabled}
              onChange={(event) => update(line.key, { price: event.target.value })}
              hint={
                product?.price
                  ? "Порожнє поле: ціна за прайсом."
                  : product
                    ? "У прайсі для цього товару немає ціни: вкажіть її тут."
                    : undefined
              }
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
      {lines.length === 0 ? (
        <Text variant="muted">Тут можна додати рідкий азот та інші товари.</Text>
      ) : null}
      {!disabled ? (
        <MainButton
          variant="outline"
          fullWidth={false}
          onClick={() => onChange([...lines, { key: nextKey(), code: "", qty: "", price: "" }])}
        >
          {lines.length === 0 ? "Додати товар" : "Додати ще товар"}
        </MainButton>
      ) : null}
    </div>
  );
}
