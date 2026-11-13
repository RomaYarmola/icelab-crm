"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orderStatus } from "@/db/schema/enums";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { reportError } from "@/server/error-log";
import { ValidationError } from "@/server/errors";
import {
  readOptionalInt,
  readOptionalText,
  readText,
  runFormAction,
  UNEXPECTED_ERROR_MESSAGE,
} from "@/server/form-state";
import { ForbiddenError } from "@/server/guards";
import {
  findDuplicateOrders,
  type DuplicateOrder,
  type OrderTemplate,
  repeatLastOrder,
} from "@/server/order-duplicates";
import {
  type ClientAddressOption,
  getOrderPricing,
  listClientAddressOptions,
  type OrderPricing,
  searchClientsForOrder,
} from "@/server/order-form";
import { addOrderItem, deleteOrderItem, updateOrderItem } from "@/server/order-items";
import { cancelAsDuplicate, changeOrderPrice, transitionOrder } from "@/server/order-status";
import {
  createOrder,
  type CreateOrderInput,
  deleteDraftOrder,
  listOrders,
  type OrderListPage,
  type UpdateOrderInput,
  updateOrder,
} from "@/server/orders";
import type { ClientListItem } from "@/server/client-views";
import type { FormState } from "@/utils/formState";

/**
 * Дії розділу «Замовлення»: кожна читає поля форми, викликає серверну функцію (права й правила
 * перевіряє вона) і повертає стан для екрана. Помилки введення повертаються з введеними значеннями.
 */

function refresh() {
  revalidatePath("/orders", "layout");
  // Статус замовлення видно й на екрані виробництва та в готівці (B6).
  revalidatePath("/production", "layout");
  revalidatePath("/more/cash");
}

function readId(formData: FormData, name = "id"): string {
  const parsed = z.uuid().safeParse(readText(formData, name));
  if (!parsed.success) throw new ValidationError("Замовлення не знайдено.");
  return parsed.data;
}

function echo(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, readText(formData, name)]));
}

const ORDER_FIELD_NAMES = [
  "clientId",
  "locationId",
  "orderDate",
  "iceTypeId",
  "kgSold",
  "kgToProduce",
  "sourceId",
  "deliveryMethod",
  "addressId",
  "deliveryText",
  "timeWindow",
  "recipientName",
  "recipientPhone",
  "boxTypeId",
  "boxCount",
  "boxOwnership",
  "paymentKind",
  "comment",
  "internalComment",
  "price",
  "note",
  "itemsJson",
];

/** Значення поля форми: порожнє означає «не вказано» (`undefined`), щоб діяли значення за замовчуванням. */
const optional = (formData: FormData, name: string) =>
  readOptionalText(formData, name) ?? undefined;

/**
 * Додаткові позиції нового замовлення: форма надсилає їх JSON-рядком у прихованому полі
 * `itemsJson`. Значення перевіряє схема всередині `createOrder`.
 */
function readNewItems(formData: FormData): CreateOrderInput["items"] {
  const raw = readOptionalText(formData, "itemsJson");
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Не вдалося прочитати додаткові позиції.");
  }
  if (!Array.isArray(parsed)) throw new ValidationError("Не вдалося прочитати додаткові позиції.");
  return parsed as CreateOrderInput["items"];
}

/** Поля нового замовлення з форми. Значення перевіряє схема всередині серверної функції. */
function readCreateFields(formData: FormData): CreateOrderInput {
  const boxCount = readOptionalInt(formData, "boxCount");
  return {
    clientId: readText(formData, "clientId"),
    locationId: readText(formData, "locationId"),
    orderDate: readText(formData, "orderDate"),
    iceTypeId: optional(formData, "iceTypeId"),
    kgSold: optional(formData, "kgSold"),
    kgToProduce: optional(formData, "kgToProduce"),
    sourceId: optional(formData, "sourceId"),
    deliveryMethod: optional(formData, "deliveryMethod") as CreateOrderInput["deliveryMethod"],
    addressId: optional(formData, "addressId"),
    deliveryText: optional(formData, "deliveryText"),
    timeWindow: optional(formData, "timeWindow"),
    recipientName: optional(formData, "recipientName"),
    recipientPhone: optional(formData, "recipientPhone"),
    boxTypeId: optional(formData, "boxTypeId"),
    boxCount: boxCount === null ? undefined : boxCount,
    boxOwnership: optional(formData, "boxOwnership") as CreateOrderInput["boxOwnership"],
    paymentKind: optional(formData, "paymentKind") as CreateOrderInput["paymentKind"],
    comment: optional(formData, "comment"),
    internalComment: optional(formData, "internalComment"),
    price: optional(formData, "price"),
    items: readNewItems(formData),
  };
}

/**
 * Зміни з форми: беремо лише поля, які форма надіслала. Порожнє поле тексту очищає значення,
 * порожня ціна означає «порахувати за прайсом», порожні обов'язкові поля не чіпаємо.
 */
function readUpdateFields(formData: FormData): UpdateOrderInput {
  const patch: Record<string, unknown> = {};
  const nullable = [
    "iceTypeId",
    "sourceId",
    "addressId",
    "deliveryText",
    "timeWindow",
    "recipientName",
    "recipientPhone",
    "boxTypeId",
    "comment",
    "internalComment",
  ];
  const required = [
    "clientId",
    "locationId",
    "orderDate",
    "kgSold",
    "kgToProduce",
    "deliveryMethod",
    "boxOwnership",
    "paymentKind",
  ];
  for (const name of nullable)
    if (formData.has(name)) patch[name] = readOptionalText(formData, name);
  for (const name of required) {
    const value = optional(formData, name);
    if (formData.has(name) && value !== undefined) patch[name] = value;
  }
  const boxCount = readOptionalInt(formData, "boxCount");
  if (formData.has("boxCount") && boxCount !== null) patch.boxCount = boxCount;
  if (formData.has("price")) patch.price = readOptionalText(formData, "price");
  return patch as UpdateOrderInput;
}

export async function createOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ORDER_FIELD_NAMES);
  let created: { id: string } | undefined;

  const state = await runFormAction(
    async () => {
      created = await createOrder(getDb(), actor, readCreateFields(formData));
    },
    { success: "Замовлення створено.", values },
  );

  if (created) {
    refresh();
    redirect(`/orders/${created.id}?created=1`);
  }
  return state;
}

export async function updateOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const values = echo(formData, ORDER_FIELD_NAMES);
  return runFormAction(
    async () => {
      await updateOrder(getDb(), actor, readId(formData), readUpdateFields(formData), {
        note: readOptionalText(formData, "note") ?? undefined,
      });
      refresh();
    },
    { success: "Зміни збережено.", values },
  );
}

export async function transitionOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      const to = z.enum(orderStatus.enumValues).safeParse(readText(formData, "to"));
      if (!to.success) throw new ValidationError("Оберіть, у який статус перевести замовлення.");
      await transitionOrder(getDb(), actor, readId(formData), to.data, {
        note: readOptionalText(formData, "note") ?? undefined,
      });
      refresh();
    },
    { success: "Статус змінено.", values: echo(formData, ["to", "note"]) },
  );
}

export async function changeOrderPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await changeOrderPrice(getDb(), actor, readId(formData), {
        pricePerKg: readText(formData, "pricePerKg"),
        note: readText(formData, "note"),
      });
      refresh();
    },
    { success: "Ціну змінено.", values: echo(formData, ["pricePerKg", "note"]) },
  );
}

export async function deleteDraftOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const state = await runFormAction(
    async () => {
      await deleteDraftOrder(getDb(), actor, readId(formData));
      refresh();
    },
    { success: "Чернетку видалено." },
  );
  if (state.status === "success") redirect("/orders");
  return state;
}

export async function cancelAsDuplicateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  const state = await runFormAction(
    async () => {
      await cancelAsDuplicate(getDb(), actor, readId(formData), readId(formData, "originalId"));
      refresh();
    },
    { success: "Замовлення скасовано як дубль." },
  );
  if (state.status === "success") redirect(`/orders/${readText(formData, "originalId")}`);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Позиції
// ---------------------------------------------------------------------------------------------

const ITEM_FIELD_NAMES = ["kind", "title", "qty", "unit", "price", "note"];

export async function addOrderItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await addOrderItem(
        getDb(),
        actor,
        readId(formData, "orderId"),
        {
          kind: readText(formData, "kind") as "delivery",
          title: readText(formData, "title"),
          qty: readText(formData, "qty"),
          unit: optional(formData, "unit"),
          price: readText(formData, "price"),
        },
        { note: readOptionalText(formData, "note") ?? undefined },
      );
      refresh();
    },
    { success: "Позицію додано.", values: echo(formData, ITEM_FIELD_NAMES) },
  );
}

export async function updateOrderItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await updateOrderItem(
        getDb(),
        actor,
        readId(formData),
        {
          title: readText(formData, "title"),
          qty: readText(formData, "qty"),
          unit: optional(formData, "unit"),
          price: readText(formData, "price"),
        },
        { note: readOptionalText(formData, "note") ?? undefined },
      );
      refresh();
    },
    { success: "Позицію збережено.", values: echo(formData, ITEM_FIELD_NAMES) },
  );
}

export async function deleteOrderItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireUser();
  return runFormAction(
    async () => {
      await deleteOrderItem(getDb(), actor, readId(formData), {
        note: readOptionalText(formData, "note") ?? undefined,
      });
      refresh();
    },
    { success: "Позицію видалено." },
  );
}

// ---------------------------------------------------------------------------------------------
// Читання для екранів
// ---------------------------------------------------------------------------------------------

export type LoadMoreOrdersResult =
  { ok: true; page: OrderListPage } | { ok: false; message: string };

const loadMoreSchema = z.object({
  dateFrom: z.string().max(10).optional(),
  dateTo: z.string().max(10).optional(),
  statuses: z.array(z.string().max(20)).max(8).optional(),
  managerId: z.string().max(64).optional(),
  deliveryMethod: z.string().max(20).optional(),
  locationId: z.string().max(64).optional(),
  search: z.string().max(200).optional(),
  offset: z.number().int().min(0).max(100_000),
});

/** Наступна частина списку замовлень (кнопка «Показати ще»). Права й значення перевіряє `listOrders`. */
export async function loadMoreOrdersAction(
  query: z.input<typeof loadMoreSchema>,
): Promise<LoadMoreOrdersResult> {
  const actor = await requireUser();
  const parsed = loadMoreSchema.safeParse(query);
  if (!parsed.success) return { ok: false, message: "Не вдалося завантажити замовлення." };
  try {
    return {
      ok: true,
      page: await listOrders(getDb(), actor, {
        ...parsed.data,
        statuses: parsed.data.statuses as never,
      }),
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message };
    }
    await reportError({ source: "form_action", error });
    return { ok: false, message: UNEXPECTED_ERROR_MESSAGE };
  }
}

/** Підказка «Схоже замовлення вже є» (D56). Будь-яка помилка дає порожній список: це лише підказка. */
export async function findDuplicateOrdersAction(input: {
  clientId: string;
  orderDate: string;
  iceTypeId?: string | null;
  excludeId?: string;
}): Promise<DuplicateOrder[]> {
  const actor = await requireUser();
  try {
    return await findDuplicateOrders(getDb(), actor, input);
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return [];
  }
}

/** «Як минулого разу» (D57): шаблон з останнього замовлення клієнта, `null`, якщо його немає чи помилка. */
export async function repeatLastOrderAction(clientId: string): Promise<OrderTemplate | null> {
  const actor = await requireUser();
  try {
    return await repeatLastOrder(getDb(), actor, typeof clientId === "string" ? clientId : "");
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Підказки форми замовлення
// ---------------------------------------------------------------------------------------------

/** Пошук клієнта у формі замовлення (код, назва, телефон). Будь-яка помилка дає порожній список. */
export async function searchClientsForOrderAction(query: string): Promise<ClientListItem[]> {
  const actor = await requireUser();
  try {
    return await searchClientsForOrder(getDb(), actor, typeof query === "string" ? query : "");
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return [];
  }
}

/** Адреси вибраного клієнта для списку в формі. Помилка дає порожній список. */
export async function clientAddressesAction(clientId: string): Promise<ClientAddressOption[]> {
  const actor = await requireUser();
  try {
    return await listClientAddressOptions(
      getDb(),
      actor,
      typeof clientId === "string" ? clientId : "",
    );
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return [];
  }
}

/** Ціна за прайсом і надбавка для підказок у формі. Помилка дає `null`: підказки зникають. */
export async function orderPricingAction(input: {
  clientId: string;
  iceTypeId?: string | null;
  orderDate: string;
  deliveryMethod?: string | null;
}): Promise<OrderPricing | null> {
  const actor = await requireUser();
  try {
    return await getOrderPricing(getDb(), actor, input);
  } catch (error) {
    if (!(error instanceof ValidationError || error instanceof ForbiddenError)) {
      await reportError({ source: "form_action", error });
    }
    return null;
  }
}
