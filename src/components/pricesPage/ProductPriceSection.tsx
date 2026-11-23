"use client";

import { useActionState } from "react";
import type { ProductPriceHistoryItem } from "@/server/product-prices";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import { formatMoney } from "@/utils/formatNumber";
import { formatIsoDate } from "@/utils/isoDate";
import { describePeriod, isActiveOn, isUpcoming } from "@/utils/priceView";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";

interface ProductPriceSectionProps {
  /** Код товару без типів (рідкий азот: `nitrogen`). */
  productCode: string;
  title: string;
  /** Одиниця в підписах: «кг» чи «шт». */
  unit: string;
  prices: ProductPriceHistoryItem[];
  today: string;
  canEdit: boolean;
  action: FormAction;
}

const asPrice = (row: ProductPriceHistoryItem) => ({
  pricePerKg: row.pricePerUnit,
  validFrom: row.validFrom,
  validTo: row.validTo,
});

function PriceForm({
  action,
  productCode,
  unit,
  today,
}: {
  action: FormAction;
  productCode: string;
  unit: string;
  today: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { pricePerUnit: "", validFrom: today, ...state.values };
  return (
    <Form action={formAction}>
      <input type="hidden" name="productCode" value={productCode} />
      <CustomizedInput
        name="pricePerUnit"
        label={`Ціна, ₴/${unit}`}
        inputMode="decimal"
        autoComplete="off"
        placeholder="90"
        defaultValue={values.pricePerUnit}
        required
      />
      <CustomizedInput
        name="validFrom"
        type="date"
        label="Діє з дати"
        defaultValue={values.validFrom}
        hint="Стара ціна закриється днем раніше, історія збережеться. Можна вказати майбутню дату."
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти ціну
      </MainButton>
    </Form>
  );
}

/** Ціна товару без типів (рідкий азот, D176): чинна, майбутня, історія й нова ціна від дати. */
export default function ProductPriceSection({
  productCode,
  title,
  unit,
  prices,
  today,
  canEdit,
  action,
}: ProductPriceSectionProps) {
  const current = prices.find((price) => isActiveOn(asPrice(price), today));
  const upcoming = prices
    .filter((price) => isUpcoming(asPrice(price), today))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
  return (
    <section aria-labelledby={`price-${productCode}`} className="flex flex-col gap-4">
      <SectionTitle id={`price-${productCode}`}>{title}</SectionTitle>
      <ul className="grid items-start gap-4 lg:grid-cols-2">
        <Card as="li" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <SubTitle>Ціна за {unit}</SubTitle>
            <Text variant="kpi" className="font-extrabold">
              {current ? `${formatMoney(Number(current.pricePerUnit))}/${unit}` : "Немає ціни"}
            </Text>
            {current ? <Text variant="muted">Діє з {formatIsoDate(current.validFrom)}</Text> : null}
            {upcoming ? (
              <Text>
                З {formatIsoDate(upcoming.validFrom)}: {formatMoney(Number(upcoming.pricePerUnit))}/
                {unit}
              </Text>
            ) : null}
          </div>
          {canEdit ? (
            <Disclosure
              key={prices.map((price) => price.id).join(",")}
              summary="Нова ціна від дати"
            >
              <PriceForm action={action} productCode={productCode} unit={unit} today={today} />
            </Disclosure>
          ) : null}
          <Disclosure variant="plain" summary="Історія цін">
            {prices.length === 0 ? (
              <Text variant="muted">Цін ще немає.</Text>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {prices.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <Text as="span" variant="label">
                      {formatMoney(Number(row.pricePerUnit))}/{unit}
                    </Text>
                    <Text as="span" variant="muted">
                      {describePeriod(asPrice(row), today)}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </Disclosure>
        </Card>
      </ul>
    </section>
  );
}
