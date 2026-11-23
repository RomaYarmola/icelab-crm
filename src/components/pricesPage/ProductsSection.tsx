"use client";

import { useActionState } from "react";
import type { ProductView } from "@/server/products";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import Checkbox from "../shared/customizedInput/Checkbox";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";

interface ProductsSectionProps {
  products: ProductView[];
  canEdit: boolean;
  createAction: FormAction;
  updateAction: FormAction;
}

const METHODS = [
  { value: "pickup", label: "Самовивіз" },
  { value: "our_delivery", label: "Власна доставка" },
  { value: "np", label: "Нова Пошта" },
];

const KIND_LABELS = { ice: "Лід", box: "Бокси", other: "Інший товар" } as const;

function deliveryText(product: ProductView): string {
  if (!product.allowedDeliveryMethods) return "Будь-який спосіб доставки";
  return METHODS.filter((method) => product.allowedDeliveryMethods?.includes(method.value))
    .map((method) => method.label)
    .join(", ");
}

function MethodCheckboxes({ allowed }: { allowed: string[] | null }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="mb-1 text-body font-semibold text-navy">Способи доставки</legend>
      {METHODS.map((method) => (
        <Checkbox
          key={method.value}
          name="deliveryMethod"
          value={method.value}
          label={method.label}
          defaultChecked={allowed === null || allowed.includes(method.value)}
        />
      ))}
    </fieldset>
  );
}

function ProductForm({
  product,
  action,
  submitLabel,
}: {
  product?: ProductView;
  action: FormAction;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { name: product?.name ?? "", unit: "кг", ...state.values };
  return (
    <Form action={formAction}>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <CustomizedInput
        name="name"
        label="Назва товару"
        autoComplete="off"
        defaultValue={values.name}
        required
      />
      {product ? null : (
        <CustomizedSelect
          name="unit"
          label="У чому рахуємо"
          options={[
            { value: "кг", label: "Кілограми" },
            { value: "шт", label: "Штуки" },
          ]}
          defaultValue={values.unit}
          hint="Потім не змінюється."
        />
      )}
      <Checkbox
        name="producedByWorkshop"
        label="Виробляє цех"
        defaultChecked={product?.producedByWorkshop ?? true}
        hint="Тоді товар видно на картці замовлення в цеху."
      />
      <MethodCheckboxes allowed={product?.allowedDeliveryMethods ?? null} />
      {product ? (
        <Checkbox
          name="isActive"
          label="Активний"
          defaultChecked={product.isActive}
          hint="Неактивний товар не пропонується в нових замовленнях."
        />
      ) : null}
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        {submitLabel}
      </MainButton>
    </Form>
  );
}

/**
 * Довідник товарів (D174): лід і бокси завжди є, інші товари (рідкий азот та майбутні) власник
 * додає й змінює тут. Новий товар з'являється в замовленні, прайсі й цеху без змін коду.
 */
export default function ProductsSection({
  products,
  canEdit,
  createAction,
  updateAction,
}: ProductsSectionProps) {
  return (
    <section aria-labelledby="products-catalog" className="flex flex-col gap-4">
      <SectionTitle id="products-catalog">Товари</SectionTitle>
      <Text variant="muted" className="max-w-xl">
        Усе, що ми продаємо. Лід і бокси мають свої довідники (типи льоду й тари), інші товари
        додаються тут.
      </Text>
      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {products.map((product) => (
          <Card as="li" key={product.id} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <SubTitle className="min-w-0 break-words">{product.name}</SubTitle>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <Tag>{KIND_LABELS[product.kind]}</Tag>
                {product.isActive ? null : <Tag>Неактивний</Tag>}
              </div>
            </div>
            <Text variant="muted">
              Рахуємо в {product.unit === "кг" ? "кілограмах" : "штуках"}
              {product.producedByWorkshop ? ", виробляє цех" : ""}.
            </Text>
            <Text variant="muted">Доставка: {deliveryText(product)}.</Text>
            {canEdit && product.kind === "other" ? (
              <Disclosure variant="plain" summary="Змінити">
                <ProductForm product={product} action={updateAction} submitLabel="Зберегти товар" />
              </Disclosure>
            ) : null}
          </Card>
        ))}
      </ul>
      {canEdit ? (
        <Disclosure summary="Додати товар">
          <ProductForm action={createAction} submitLabel="Додати товар" />
        </Disclosure>
      ) : null}
    </section>
  );
}
