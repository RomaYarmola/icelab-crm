"use client";

import { useActionState, useEffect, useState } from "react";
import {
  BOX_OWNERSHIP_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_KIND_LABELS,
} from "@/constants/orders";
import type { DuplicateOrder, OrderTemplate } from "@/server/order-duplicates";
import type { ClientAddressOption, OrderPricing } from "@/server/order-form";
import type { EditPolicy } from "@/server/order-rules";
import { INLINE_HINTS } from "@/constants/hints";
import { ORDER_STATUS_LABELS } from "@/constants/orders";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import { formatMoney, formatNumber, formatPricePerKg } from "@/utils/formatNumber";
import { isIsoDate } from "@/utils/isoDate";
import { computeKgToProduce, lineAmount, parseDecimal, sumAmounts } from "@/utils/orderMath";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import PhoneField from "../shared/customizedInput/PhoneField";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import MainLink from "../shared/links/MainLink";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import ClientPicker from "./ClientPicker";
import OrderFormItems from "./OrderFormItems";
import type {
  DraftItem,
  OrderFormActions,
  OrderFormOptions,
  OrderFormValues,
  PickedClient,
} from "./orderFormTypes";

/** Нове замовлення: усе дозволено. */
const CREATE_POLICY: EditPolicy = {
  core: "free",
  price: "free",
  produce: true,
  comment: true,
  internalComment: true,
};

interface OrderFormProps {
  /** `create`: нове замовлення (клієнт, підказки, позиції), `edit`: зміна наявного за правилами D58. */
  mode: "create" | "edit";
  orderId?: string;
  options: OrderFormOptions;
  defaults: OrderFormValues;
  /** Клієнт, вибраний наперед (`?client=` чи клієнт замовлення при зміні). */
  initialClient: PickedClient | null;
  /** Що дозволено змінювати цій ролі в цьому статусі (для `edit`). */
  policy?: EditPolicy;
  /** Для `edit`: поточна ціна за кг (рядок бази) для підказки; без неї підказки про ціну немає. */
  currentPrice?: string | null;
  /** Внутрішній коментар бачать і міняють лише власник і менеджер. */
  canSeeInternal: boolean;
  actions: OrderFormActions;
  submitLabel: string;
}

const priceSourceLabel = (source: OrderPricing["source"]) =>
  source === "client"
    ? "ціна клієнта"
    : source === "client_any_type"
      ? "ціна клієнта для будь-якого типу"
      : source === "default"
        ? "за прайсом"
        : "";

/**
 * Форма замовлення: створення і зміна. Система підставляє ціну (за прайсом, видно звідки) і
 * «виготовити» з надбавкою, менеджер лише перевіряє. «Як минулого разу» копіює останнє замовлення
 * клієнта, а «Схожі замовлення» попереджає про дубль (збереження не блокується). У зміні поля,
 * закриті правилами D58, вимкнені, а там, де потрібна причина (у виробництві), є поле причини.
 */
export default function OrderForm({
  mode,
  orderId,
  options,
  defaults,
  initialClient,
  policy = CREATE_POLICY,
  currentPrice,
  canSeeInternal,
  actions,
  submitLabel,
}: OrderFormProps) {
  const isCreate = mode === "create";
  const [state, formAction, isPending] = useActionState(actions.submit, INITIAL_FORM_STATE);

  const [values, setValues] = useState<OrderFormValues>(defaults);
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const [price, setPrice] = useState("");
  const [toProduceTouched, setToProduceTouched] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState("");
  const [templateApplied, setTemplateApplied] = useState(false);

  const set = <K extends keyof OrderFormValues>(name: K, value: OrderFormValues[K]) =>
    setValues((current) => ({ ...current, [name]: value }));

  // --- Підказки з сервера: ціна й надбавка, адреси клієнта, схожі замовлення, «як минулого разу».
  // Кожна відповідь прив'язана до ключа запиту: відповідь на застарілі дані не показуємо.
  const hasValidDate = isIsoDate(values.orderDate);
  const clientId = client?.id ?? "";

  const pricingKey = JSON.stringify([
    clientId,
    values.iceTypeId,
    values.orderDate,
    values.deliveryMethod,
  ]);
  const [pricingResult, setPricingResult] = useState<{
    key: string;
    data: OrderPricing | null;
  } | null>(null);
  useEffect(() => {
    if (!isCreate || !clientId || !hasValidDate) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      actions
        .pricing({
          clientId,
          iceTypeId: values.iceTypeId || null,
          orderDate: values.orderDate,
          deliveryMethod: values.deliveryMethod,
        })
        .then((data) => isCurrent && setPricingResult({ key: pricingKey, data }));
    }, 250);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [
    isCreate,
    clientId,
    hasValidDate,
    values.iceTypeId,
    values.orderDate,
    values.deliveryMethod,
    pricingKey,
    actions,
  ]);
  const pricing = pricingResult?.key === pricingKey ? pricingResult.data : null;

  const [addressesResult, setAddressesResult] = useState<{
    key: string;
    data: ClientAddressOption[];
  } | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let isCurrent = true;
    actions.clientAddresses(clientId).then((data) => {
      if (!isCurrent) return;
      setAddressesResult({ key: clientId, data });
      // Нове замовлення: підставляємо адресу клієнта за замовчуванням, якщо ще нічого не вибрано.
      if (isCreate) {
        const preferred = data.find((address) => address.isDefault);
        if (preferred)
          setValues((current) =>
            current.addressId ? current : { ...current, addressId: preferred.id },
          );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [clientId, isCreate, actions]);
  const addresses = addressesResult?.key === clientId ? addressesResult.data : [];

  const duplicatesKey = JSON.stringify([clientId, values.orderDate, values.iceTypeId]);
  const [duplicatesResult, setDuplicatesResult] = useState<{
    key: string;
    data: DuplicateOrder[];
  } | null>(null);
  useEffect(() => {
    if (!isCreate || !clientId || !hasValidDate) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      actions
        .findDuplicates({
          clientId,
          orderDate: values.orderDate,
          iceTypeId: values.iceTypeId || null,
        })
        .then((data) => isCurrent && setDuplicatesResult({ key: duplicatesKey, data }));
    }, 300);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [
    isCreate,
    clientId,
    hasValidDate,
    values.orderDate,
    values.iceTypeId,
    duplicatesKey,
    actions,
  ]);
  const duplicates = duplicatesResult?.key === duplicatesKey ? duplicatesResult.data : [];

  const [templateResult, setTemplateResult] = useState<{
    key: string;
    data: OrderTemplate | null;
  } | null>(null);
  useEffect(() => {
    if (!isCreate || !clientId) return;
    let isCurrent = true;
    actions
      .repeatLast(clientId)
      .then((data) => isCurrent && setTemplateResult({ key: clientId, data }));
    return () => {
      isCurrent = false;
    };
  }, [isCreate, clientId, actions]);
  const template = templateResult?.key === clientId ? templateResult.data : null;

  function applyTemplate(source: OrderTemplate) {
    setValues((current) => ({
      ...current,
      locationId: source.locationId,
      iceTypeId: source.iceTypeId ?? "",
      kgSold: String(parseDecimal(source.kgSold)),
      sourceId: source.sourceId ?? "",
      deliveryMethod: source.deliveryMethod,
      addressId: source.addressId ?? "",
      deliveryText: source.deliveryText ?? "",
      timeWindow: source.timeWindow ?? "",
      recipientName: source.recipientName ?? "",
      recipientPhone: source.recipientPhone ?? "",
      boxTypeId: source.boxTypeId ?? "",
      boxCount: String(source.boxCount),
      boxOwnership: source.boxOwnership,
      paymentKind: source.paymentKind,
    }));
    setItems(
      source.items.map((item, index) => ({
        key: index + 1,
        kind: item.kind,
        title: item.title,
        qty: String(parseDecimal(item.qty)),
        price: "",
      })),
    );
    setToProduceTouched(false);
    setPrice("");
    setTemplateApplied(true);
  }

  // --- Що показати й що надіслати.
  const kg = parseDecimal(values.kgSold);
  const suggestedToProduce = computeKgToProduce(kg, pricing?.markupPercent ?? 0);
  const toProduceShown = toProduceTouched
    ? values.kgToProduce
    : suggestedToProduce > 0
      ? String(suggestedToProduce)
      : values.kgToProduce;

  const manualPrice = price.trim() === "" ? null : parseDecimal(price);
  const autoPrice = pricing?.pricePerKg ? parseDecimal(pricing.pricePerKg) : null;
  const currentPriceNumber = currentPrice ? parseDecimal(currentPrice) : null;
  const effectivePrice = manualPrice ?? autoPrice ?? currentPriceNumber ?? 0;
  const itemsTotal = items.map((item) =>
    lineAmount(parseDecimal(item.qty) || 0, parseDecimal(item.price) || 0),
  );
  const total = sumAmounts([
    lineAmount(Number.isFinite(kg) ? kg : 0, effectivePrice),
    ...itemsTotal,
  ]);

  const itemsJson = JSON.stringify(
    items.map((item) => ({
      kind: item.kind,
      title: item.title,
      qty: item.qty,
      price: item.price.trim() === "" ? undefined : item.price,
    })),
  );

  const coreLocked = policy.core === "none";
  const isDisabled = !isCreate && coreLocked;
  const priceLocked = policy.price !== "free";
  const percent = pricing?.markupPercent ?? 0;

  return (
    <Form action={formAction}>
      {orderId ? <input type="hidden" name="id" value={orderId} /> : null}

      {isCreate ? (
        <ClientPicker value={client} onChange={setClient} searchClients={actions.searchClients} />
      ) : client ? (
        <div className="flex flex-col gap-1.5">
          <Text variant="label">Клієнт</Text>
          <Text variant="muted">
            {client.code} · {client.name}
          </Text>
        </div>
      ) : null}

      {isCreate && client && template && !templateApplied ? (
        <MainButton variant="outline" onClick={() => applyTemplate(template)}>
          Як минулого разу{template.fromNumber ? `: замовлення № ${template.fromNumber}` : ""}
        </MainButton>
      ) : null}
      {isCreate && templateApplied ? (
        <Text variant="muted">
          Дані взято з минулого замовлення. Перевірте їх: дата нова, ціни за чинним прайсом, ціни
          додаткових позицій треба вказати.
        </Text>
      ) : null}

      <fieldset disabled={isDisabled} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <SectionTitle>Коли і звідки</SectionTitle>
        <CustomizedInput
          name="orderDate"
          type="date"
          label="Дата виконання"
          value={values.orderDate}
          onChange={(event) => set("orderDate", event.target.value)}
          required
        />
        <CustomizedSelect
          name="locationId"
          label="Локація"
          options={options.locations.map((item) => ({ value: item.id, label: item.name }))}
          value={values.locationId}
          onChange={(event) => set("locationId", event.target.value)}
          hint="Де замовлення виготовляють і відправляють."
        />

        <SectionTitle>Лід</SectionTitle>
        <CustomizedSelect
          name="iceTypeId"
          label="Тип льоду"
          options={[
            { value: "", label: "Не вказано" },
            ...options.iceTypes.map((item) => ({ value: item.id, label: item.name })),
          ]}
          value={values.iceTypeId}
          onChange={(event) => set("iceTypeId", event.target.value)}
        />
        <CustomizedInput
          name="kgSold"
          label="Продано, кг"
          inputMode="decimal"
          autoComplete="off"
          value={values.kgSold}
          onChange={(event) => set("kgSold", event.target.value)}
        />
      </fieldset>

      <fieldset
        disabled={!isCreate && !policy.produce}
        className="flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        <CustomizedInput
          // Поле без назви не надсилається: поки «виготовити» не виправлено вручну, його рахує сервер.
          name={toProduceTouched ? "kgToProduce" : ""}
          label="Виготовити, кг"
          inputMode="decimal"
          autoComplete="off"
          value={toProduceShown}
          onChange={(event) => {
            setToProduceTouched(true);
            set("kgToProduce", event.target.value);
          }}
          hint={
            toProduceTouched
              ? "Виправлено вручну: надбавка вже не перераховується."
              : percent > 0
                ? `Підказка: продано ${formatNumber(kg || 0)} кг + надбавка ${percent}%. Можна змінити.`
                : "Підказка: без надбавки. Можна змінити."
          }
        />
        <Text variant="muted">{INLINE_HINTS.orderKg}</Text>
      </fieldset>

      <fieldset
        disabled={isDisabled || priceLocked}
        className="flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        <CustomizedInput
          // Порожня ціна не надсилається: тоді діє ціна за прайсом.
          name={price.trim() === "" ? "" : "price"}
          label="Ціна, ₴/кг"
          inputMode="decimal"
          autoComplete="off"
          placeholder={
            autoPrice !== null
              ? String(autoPrice)
              : currentPriceNumber !== null
                ? String(currentPriceNumber)
                : "75"
          }
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          hint={
            priceLocked && !isCreate
              ? "Після підтвердження ціну змінює власник через «Змінити ціну» на картці замовлення."
              : pricing?.pricePerKg
                ? `Ціна ${formatPricePerKg(pricing.pricePerKg)} (${priceSourceLabel(pricing.source)}). Залиште порожнім, щоб взяти її, або вкажіть свою.`
                : isCreate && client && values.iceTypeId && pricing
                  ? "Для цього клієнта й типу льоду ціни немає: внесіть її в прайс чи в картку клієнта або вкажіть тут."
                  : currentPriceNumber !== null
                    ? `Зараз ${formatPricePerKg(currentPriceNumber)}. Вкажіть, щоб змінити.`
                    : "Ціну підставимо за прайсом, коли оберете клієнта й тип льоду."
          }
        />
      </fieldset>

      {isCreate && duplicates.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-field bg-status-in-production px-4 py-3 text-body text-status-in-production-text"
        >
          <p className="font-bold">Схоже замовлення вже є</p>
          <ul className="flex flex-col gap-1">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                <MainLink href={`/orders/${duplicate.id}`} isExternal>
                  № {duplicate.number ?? "—"}
                </MainLink>{" "}
                ({ORDER_STATUS_LABELS[duplicate.status].toLowerCase()},{" "}
                {formatNumber(parseDecimal(duplicate.kgSold))} кг)
              </li>
            ))}
          </ul>
          <p>Якщо це інше замовлення, просто збережіть: нічого не заблоковано.</p>
        </div>
      ) : null}

      <fieldset disabled={isDisabled} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <SectionTitle>Доставка</SectionTitle>
        <CustomizedSelect
          name="deliveryMethod"
          label="Спосіб доставки"
          options={Object.entries(DELIVERY_METHOD_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
          value={values.deliveryMethod}
          onChange={(event) => set("deliveryMethod", event.target.value)}
        />
        {addresses.length > 0 ? (
          <CustomizedSelect
            name="addressId"
            label="Адреса клієнта"
            options={[
              { value: "", label: "Не вибрано" },
              ...addresses.map((address) => ({ value: address.id, label: address.text })),
            ]}
            value={values.addressId}
            onChange={(event) => set("addressId", event.target.value)}
          />
        ) : null}
        <CustomizedInput
          name="deliveryText"
          label="Адреса текстом"
          as="textarea"
          value={values.deliveryText}
          onChange={(event) => set("deliveryText", event.target.value)}
          hint="Необов'язково: якщо адреси немає в списку клієнта."
        />
        <CustomizedInput
          name="timeWindow"
          label="Вікно часу"
          autoComplete="off"
          value={values.timeWindow}
          onChange={(event) => set("timeWindow", event.target.value)}
          hint="Необов'язково: наприклад, 10:00-14:00."
        />
        <CustomizedInput
          name="recipientName"
          label="Отримувач"
          autoComplete="off"
          value={values.recipientName}
          onChange={(event) => set("recipientName", event.target.value)}
        />
        <PhoneField
          name="recipientPhone"
          label="Телефон отримувача"
          value={values.recipientPhone}
          onChange={(event) => set("recipientPhone", event.target.value)}
        />

        <SectionTitle>Тара й оплата</SectionTitle>
        <CustomizedSelect
          name="boxTypeId"
          label="Тара"
          options={[
            { value: "", label: "Не вказано" },
            ...options.boxTypes.map((item) => ({ value: item.id, label: item.name })),
          ]}
          value={values.boxTypeId}
          onChange={(event) => set("boxTypeId", event.target.value)}
        />
        <CustomizedInput
          name="boxCount"
          label="Кількість тари"
          inputMode="numeric"
          autoComplete="off"
          value={values.boxCount}
          onChange={(event) => set("boxCount", event.target.value)}
        />
        <CustomizedSelect
          name="boxOwnership"
          label="Чия тара"
          options={Object.entries(BOX_OWNERSHIP_LABELS).map(([value, label]) => ({ value, label }))}
          value={values.boxOwnership}
          onChange={(event) => set("boxOwnership", event.target.value)}
        />
        <CustomizedSelect
          name="paymentKind"
          label="Спосіб оплати"
          options={Object.entries(PAYMENT_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          value={values.paymentKind}
          onChange={(event) => set("paymentKind", event.target.value)}
        />
        <CustomizedSelect
          name="sourceId"
          label="Джерело"
          options={[
            { value: "", label: "Не вказано" },
            ...options.sources.map((item) => ({ value: item.id, label: item.name })),
          ]}
          value={values.sourceId}
          onChange={(event) => set("sourceId", event.target.value)}
        />
      </fieldset>

      <SectionTitle>Коментарі</SectionTitle>
      <fieldset
        disabled={!isCreate && !policy.comment}
        className="flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        <CustomizedInput
          name="comment"
          label="Коментар для виробництва"
          as="textarea"
          value={values.comment}
          onChange={(event) => set("comment", event.target.value)}
          hint="Його бачать і на виробництві."
        />
      </fieldset>
      {canSeeInternal ? (
        <fieldset
          disabled={!isCreate && !policy.internalComment}
          className="flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <CustomizedInput
            name="internalComment"
            label="Внутрішній коментар"
            as="textarea"
            value={values.internalComment}
            onChange={(event) => set("internalComment", event.target.value)}
            hint="Лише для власника й менеджерів."
          />
        </fieldset>
      ) : null}

      {isCreate ? (
        <Disclosure
          summary={`Додаткові позиції${items.length > 0 ? ` · ${items.length}` : ""}`}
          defaultOpen={items.length > 0}
        >
          <OrderFormItems items={items} onChange={setItems} />
          <input type="hidden" name="itemsJson" value={items.length > 0 ? itemsJson : ""} />
        </Disclosure>
      ) : null}

      {!isCreate && policy.core === "owner_note" ? (
        <CustomizedInput
          name="note"
          label="Причина зміни"
          as="textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="Замовлення вже у виробництві: зміна й причина лишаються в історії."
          required
        />
      ) : null}

      <Card className="flex items-baseline justify-between gap-3">
        <Text variant="label">Сума замовлення</Text>
        <Text variant="kpi" className="font-extrabold">
          {formatMoney(parseDecimal(total))}
        </Text>
      </Card>

      <FormMessage state={state} />
      <MainButton
        type="submit"
        isLoading={isPending}
        loadingText="Зберігаємо…"
        disabled={isCreate && !client}
      >
        {submitLabel}
      </MainButton>
      {isCreate && !client ? <Text variant="muted">Спершу виберіть клієнта.</Text> : null}
    </Form>
  );
}
