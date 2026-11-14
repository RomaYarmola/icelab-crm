"use client";

import { useActionState } from "react";
import type { OrderBox } from "@/server/boxes";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import Tag from "../shared/chips/Tag";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface OrderBoxesProps {
  orderId: string;
  boxes: OrderBox[];
  /** Власник і старший локації продають бокс у замовленні (D108). */
  sellAction: FormAction | null;
}

/** Бокси замовлення з кодами (ТЗ 6.3) і форма «Продати бокс» (D108). */
export default function OrderBoxes({ orderId, boxes, sellAction }: OrderBoxesProps) {
  const [state, formAction, isPending] = useActionState(
    sellAction ?? (async () => INITIAL_FORM_STATE),
    INITIAL_FORM_STATE,
  );
  if (boxes.length === 0 && !sellAction) return null;
  return (
    <section aria-labelledby="order-boxes" className="flex flex-col gap-3">
      <SectionTitle id="order-boxes">Бокси</SectionTitle>
      {boxes.length === 0 ? (
        <Text variant="muted">Боксів у замовленні ще немає.</Text>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {boxes.map((box) => (
            <li key={box.code}>
              <Tag>
                {box.code} · {box.statusLabel}
              </Tag>
            </li>
          ))}
        </ul>
      )}
      {sellAction ? (
        <Disclosure summary="Продати бокс">
          <Form action={formAction}>
            <input type="hidden" name="orderId" value={orderId} />
            <CustomizedInput
              name="code"
              label="Код бокса"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="K-0012"
              defaultValue={state.values?.code ?? ""}
              hint="Бокс стане «Продано», а в замовленні з'явиться позиція «Продаж боксу»."
              required
            />
            <FormMessage state={state} />
            <MainButton type="submit" isLoading={isPending} loadingText="Записуємо…">
              Продати бокс
            </MainButton>
          </Form>
        </Disclosure>
      ) : null}
    </section>
  );
}
