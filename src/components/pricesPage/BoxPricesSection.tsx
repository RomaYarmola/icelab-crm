"use client";

import { useActionState } from "react";
import type { BoxPriceHistoryItem } from "@/server/product-prices";
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

interface BoxPricesSectionProps {
  /** Типи боксів, які продаємо (без боксів клієнтів). */
  boxTypes: { id: string; name: string }[];
  prices: BoxPriceHistoryItem[];
  today: string;
  canEdit: boolean;
  action: FormAction;
}

const asPrice = (row: BoxPriceHistoryItem) => ({
  pricePerKg: row.pricePerUnit,
  validFrom: row.validFrom,
  validTo: row.validTo,
});

function BoxPriceForm({
  action,
  boxTypeId,
  today,
}: {
  action: FormAction;
  boxTypeId: string;
  today: string;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { pricePerUnit: "", validFrom: today, ...state.values };
  return (
    <Form action={formAction}>
      <input type="hidden" name="boxTypeId" value={boxTypeId} />
      <CustomizedInput
        name="pricePerUnit"
        label="Ціна, ₴/шт"
        inputMode="decimal"
        autoComplete="off"
        placeholder="500"
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

/** Ціни на бокси, які продаємо окремо (D174, D175): чинна ціна, майбутня, історія й нова ціна від дати. */
export default function BoxPricesSection({
  boxTypes,
  prices,
  today,
  canEdit,
  action,
}: BoxPricesSectionProps) {
  return (
    <section aria-labelledby="box-prices" className="flex flex-col gap-4">
      <SectionTitle id="box-prices">Бокси на продаж</SectionTitle>
      <Text variant="muted" className="max-w-xl">
        Ціна за штуку для кожного виду бокса. Підставляється в замовлення, де продаємо бокси; у
        замовленні її можна змінити вручну.
      </Text>
      <ul className="grid items-start gap-4 lg:grid-cols-2">
        {boxTypes.map((type) => {
          const own = prices.filter((price) => price.boxTypeId === type.id);
          const current = own.find((price) => isActiveOn(asPrice(price), today));
          const upcoming = own
            .filter((price) => isUpcoming(asPrice(price), today))
            .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
          return (
            <Card as="li" key={type.id} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <SubTitle>{type.name}</SubTitle>
                <Text variant="kpi" className="font-extrabold">
                  {current ? `${formatMoney(Number(current.pricePerUnit))}/шт` : "Немає ціни"}
                </Text>
                {current ? (
                  <Text variant="muted">Діє з {formatIsoDate(current.validFrom)}</Text>
                ) : null}
                {upcoming ? (
                  <Text>
                    З {formatIsoDate(upcoming.validFrom)}:{" "}
                    {formatMoney(Number(upcoming.pricePerUnit))}/шт
                  </Text>
                ) : null}
              </div>
              {canEdit ? (
                <Disclosure
                  key={own.map((price) => price.id).join(",")}
                  summary="Нова ціна від дати"
                >
                  <BoxPriceForm action={action} boxTypeId={type.id} today={today} />
                </Disclosure>
              ) : null}
              <Disclosure variant="plain" summary="Історія цін">
                {own.length === 0 ? (
                  <Text variant="muted">Цін ще немає.</Text>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {own.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3"
                      >
                        <Text as="span" variant="label">
                          {formatMoney(Number(row.pricePerUnit))}/шт
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
          );
        })}
      </ul>
    </section>
  );
}
