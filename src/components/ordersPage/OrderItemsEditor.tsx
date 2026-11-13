"use client";

import { useActionState } from "react";
import type { OrderItemView } from "@/server/dto";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import { formatMoney, formatNumber } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import type { FormAction } from "../clientsPage/clientActions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";

const KIND_OPTIONS = [
  { value: "delivery", label: "Доставка" },
  { value: "box_sale", label: "Продаж боксу" },
  { value: "other", label: "Інше" },
];

export interface OrderItemActions {
  addItem: FormAction;
  updateItem: FormAction;
  deleteItem: FormAction;
}

interface OrderItemsEditorProps {
  orderId: string;
  /** Додаткові позиції (без «Льоду»), з цінами: редактор лише для ролей, які бачать гроші. */
  items: OrderItemView[];
  /** Замовлення вже у виробництві: зміни лише власника і з причиною. */
  needsNote: boolean;
  actions: OrderItemActions;
}

function NoteField({ needsNote }: { needsNote: boolean }) {
  if (!needsNote) return null;
  return (
    <CustomizedInput
      name="note"
      label="Причина зміни"
      as="textarea"
      hint="Замовлення вже у виробництві: зміна й причина лишаються в історії."
      required
    />
  );
}

function AddItemForm({
  orderId,
  needsNote,
  action,
}: {
  orderId: string;
  needsNote: boolean;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = { kind: "delivery", title: "", qty: "1", price: "", ...state.values };

  return (
    <Form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <CustomizedSelect name="kind" label="Вид" options={KIND_OPTIONS} defaultValue={values.kind} />
      <CustomizedInput
        name="title"
        label="Назва"
        autoComplete="off"
        defaultValue={values.title}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <CustomizedInput
          name="qty"
          label="Кількість"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={values.qty}
          required
        />
        <CustomizedInput
          name="price"
          label="Ціна, ₴"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={values.price}
          required
        />
      </div>
      <NoteField needsNote={needsNote} />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Додати позицію
      </MainButton>
    </Form>
  );
}

function EditItemForm({
  item,
  needsNote,
  action,
}: {
  item: OrderItemView;
  needsNote: boolean;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const values = {
    title: item.title,
    qty: String(parseDecimal(item.qty)),
    price: item.price === undefined ? "" : String(parseDecimal(item.price)),
    ...state.values,
  };

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={item.id} />
      <CustomizedInput
        name="title"
        label="Назва"
        autoComplete="off"
        defaultValue={values.title}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <CustomizedInput
          name="qty"
          label="Кількість"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={values.qty}
          required
        />
        <CustomizedInput
          name="price"
          label="Ціна, ₴"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={values.price}
          required
        />
      </div>
      <NoteField needsNote={needsNote} />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Зберегти позицію
      </MainButton>
    </Form>
  );
}

function DeleteItemForm({
  item,
  needsNote,
  action,
}: {
  item: OrderItemView;
  needsNote: boolean;
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);

  return (
    <Disclosure variant="plain" summary="Прибрати позицію">
      <Form action={formAction}>
        <input type="hidden" name="id" value={item.id} />
        <Text variant="muted">
          Позицію буде видалено із замовлення, суму перерахуємо. Це не можна скасувати.
        </Text>
        <NoteField needsNote={needsNote} />
        <FormMessage state={state} />
        <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Видаляємо…">
          Так, прибрати
        </MainButton>
      </Form>
    </Disclosure>
  );
}

/**
 * Керування додатковими позиціями замовлення («Доставка», «Продаж боксу», «Інше») на картці:
 * додати, змінити, прибрати. Позицію «Лід» тут немає: її міняють у формі замовлення. Сума
 * замовлення перераховується базою.
 */
export default function OrderItemsEditor({
  orderId,
  items,
  needsNote,
  actions,
}: OrderItemsEditorProps) {
  return (
    <Disclosure summary="Керувати позиціями">
      <div className="flex flex-col gap-4">
        {items.length === 0 ? <Text variant="muted">Додаткових позицій немає.</Text> : null}
        {items.map((item) => (
          <div
            key={`${item.id}-${item.title}-${item.qty}-${item.price}`}
            className="flex flex-col gap-1 border-b border-grey-border pb-3"
          >
            <Disclosure
              variant="plain"
              summary={`${item.title}: ${formatNumber(parseDecimal(item.qty))} ${item.unit}${item.amount !== undefined ? `, ${formatMoney(parseDecimal(item.amount))}` : ""}`}
            >
              <EditItemForm item={item} needsNote={needsNote} action={actions.updateItem} />
            </Disclosure>
            <DeleteItemForm item={item} needsNote={needsNote} action={actions.deleteItem} />
          </div>
        ))}
        <Disclosure key={items.length} summary="Додати позицію">
          <AddItemForm orderId={orderId} needsNote={needsNote} action={actions.addItem} />
        </Disclosure>
      </div>
    </Disclosure>
  );
}
