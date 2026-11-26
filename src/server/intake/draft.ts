import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { canChargeDelivery } from "@/constants/orders";
import { clients, orderSources, products } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { normalizeClientCode } from "@/utils/clientCode";
import { isIsoDate } from "@/utils/isoDate";
import { normalizePhone } from "@/utils/phone";
import type { CreateOrderInput } from "../orders";
import type { ParseResult } from "./schema";

/**
 * З результату розбору в чернетку замовлення (B11, ТЗ 8.3, D141). Клієнта беремо лише зі списку й
 * лише якщо модель певна (впевненість від 0,7): інакше чернетка отримує службового клієнта «Новий
 * клієнт», і підтвердити її можна лише після вибору справжнього. Ціну тут не ставимо: вона
 * з'являється за звичайними правилами при підтвердженні (D52).
 */

export const MIN_CONFIDENCE = 0.7;
export const PLACEHOLDER_CODE = "НОВИЙ";
export const PLACEHOLDER_NAME = "Новий клієнт";

/** Службовий клієнт «Новий клієнт»: створюється при першій потребі, лише один на всю систему. */
export async function ensurePlaceholderClient(db: AnyPgDatabase): Promise<string> {
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.isPlaceholder, true))
    .limit(1);
  if (existing) return existing.id;
  const created = await withActor(db, null, (tx) =>
    tx
      .insert(clients)
      .values({ code: PLACEHOLDER_CODE, name: PLACEHOLDER_NAME, isPlaceholder: true })
      .onConflictDoNothing()
      .returning({ id: clients.id }),
  );
  if (created[0]) return created[0].id;
  const [again] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.isPlaceholder, true))
    .limit(1);
  return again!.id;
}

/** Нормалізована назва для порівняння: без регістру, лапок і зайвих пробілів. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[«»"'’`ʼ„“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type DraftDictionaries = {
  boxTypes: { id: string; code: string }[];
  /** Товари без типів (рідкий азот); їх може не бути в старих викликах. */
  products?: { code: string; name: string; unit: string }[];
  iceTypes: { id: string; code: string }[];
};

export type DraftBuild = {
  input: CreateOrderInput;
  clientId: string;
  /** Клієнта не визначено: у чернетці «Новий клієнт». */
  isPlaceholder: boolean;
  unclear: string[];
};

const PAYMENT_KINDS = { cash: "cash", fop: "fop", company: "company" } as const;

const clip = (value: string | null | undefined, max: number) =>
  value ? value.trim().slice(0, max) || null : null;

/** Знаходить клієнта: за кодом зі списку, інакше за точною назвою (лише коли він один). */
async function resolveClient(
  db: AnyPgDatabase,
  client: ParseResult["client"],
): Promise<string | null> {
  if (client.confidence < MIN_CONFIDENCE) return null;
  const base = and(isNull(clients.deletedAt), eq(clients.isPlaceholder, false));
  if (client.code) {
    const [byCode] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(base, eq(clients.code, normalizeClientCode(client.code))));
    if (byCode) return byCode.id;
  }
  if (client.name_guess) {
    const wanted = normalizeName(client.name_guess);
    if (wanted) {
      // Вибираємо за першим словом, а точний збіг перевіряємо вже тут, без регістру й лапок.
      const first = wanted.split(" ")[0]!;
      const candidates = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(and(base, sql`lower(${clients.name}) like ${`%${first.replace(/[\\%_]/g, "")}%`}`))
        .limit(100);
      const matches = candidates.filter((row) => normalizeName(row.name) === wanted);
      if (matches.length === 1) return matches[0]!.id;
    }
  }
  return null;
}

/** Будує вхід для `createOrder` з результату розбору. Нічого не записує. */
export async function buildDraft(
  db: AnyPgDatabase,
  parsed: ParseResult,
  context: {
    locationId: string;
    /** Дата повідомлення за Києвом: типова дата замовлення, коли дату не названо. */
    messageDay: string;
    dictionaries: DraftDictionaries;
    sourceCode?: "telegram" | "site";
  },
): Promise<DraftBuild> {
  const unclear = [...parsed.unclear];
  // Лід продаємо лише цілими кілограмами (Роман, 20.11.2026): дробове число округлюємо вниз.
  const whole = (value: number | null | undefined, what: string): number | null => {
    if (value == null || Number.isInteger(value)) return value ?? null;
    const floored = Math.floor(value);
    unclear.push(
      `${what}: ${value} кг не ціле, поставлено ${floored} кг (лід продаємо цілими кг).`,
    );
    return floored;
  };
  parsed = {
    ...parsed,
    kg_sold: whole(parsed.kg_sold, "Продано"),
    kg_to_produce: whole(parsed.kg_to_produce, "Виготовити"),
  };
  const resolved = await resolveClient(db, parsed.client);
  const isPlaceholder = resolved === null;
  const clientId = resolved ?? (await ensurePlaceholderClient(db));
  if (isPlaceholder) {
    const guess = parsed.client.name_guess ? `: «${parsed.client.name_guess}»` : "";
    unclear.push(`Клієнта не визначено${guess}. Оберіть клієнта перед підтвердженням.`);
  }

  let orderDate = parsed.order_date;
  if (!orderDate || !isIsoDate(orderDate)) {
    orderDate = context.messageDay;
    unclear.push("Дату не вказано: поставлено дату повідомлення.");
  }
  const hasExtras = Boolean(parsed.box_sales?.length || parsed.extra_products?.length);
  // Лише бокси на продаж чи інший товар (азот) без льоду: кілограмів і типу льоду не вимагаємо.
  const iceExpected = !(hasExtras && parsed.kg_sold === null && !parsed.ice_type);
  if (parsed.kg_sold === null && iceExpected) unclear.push("Не вказано кілограмів.");

  const ice = parsed.ice_type
    ? context.dictionaries.iceTypes.find((type) => type.code === parsed.ice_type)
    : undefined;
  if (!ice && iceExpected) unclear.push("Не вказано тип льоду.");

  let boxTypeId: string | null = null;
  if (parsed.box.type_code) {
    boxTypeId =
      context.dictionaries.boxTypes.find((type) => type.code === parsed.box.type_code)?.id ?? null;
    if (!boxTypeId) unclear.push(`Невідомий тип тари: «${parsed.box.type_code}».`);
  }

  let recipientPhone: string | null = null;
  if (parsed.delivery.recipient_phone) {
    recipientPhone = normalizePhone(parsed.delivery.recipient_phone);
    if (!recipientPhone) unclear.push("Телефон отримувача не розпізнано.");
  }
  if (!parsed.delivery.method) unclear.push("Спосіб доставки не вказано.");

  const deliveryText =
    [
      parsed.delivery.city,
      parsed.delivery.np_warehouse_number
        ? `відділення № ${parsed.delivery.np_warehouse_number}`
        : null,
      parsed.delivery.address,
    ]
      .filter(Boolean)
      .join(", ") || null;

  const [source] = await db
    .select({ id: orderSources.id })
    .from(orderSources)
    .where(eq(orderSources.code, context.sourceCode ?? "telegram"));

  // Бокси на продаж і інші товари (азот) окремими позиціями (D174, D176).
  const boxSales: NonNullable<CreateOrderInput["boxSales"]> = [];
  for (const sale of parsed.box_sales ?? []) {
    const type = context.dictionaries.boxTypes.find(
      (candidate) => candidate.code === sale.type_code,
    );
    if (type) boxSales.push({ boxTypeId: type.id, qty: sale.count });
    else unclear.push(`Бокс на продаж «${sale.type_code}»: такого типу немає.`);
  }
  const productLines: NonNullable<CreateOrderInput["products"]> = [];
  for (const line of parsed.extra_products ?? []) {
    const product = context.dictionaries.products?.find((item) => item.code === line.product_code);
    if (product) productLines.push({ code: product.code, qty: line.qty });
    else unclear.push(`Товар «${line.product_code}»: такого немає в списку товарів.`);
  }
  // Деякі товари (рідкий азот) поштою не відправляємо: Нову Пошту не ставимо, менеджер вибере сам.
  let deliveryMethod: NonNullable<CreateOrderInput["deliveryMethod"]> =
    parsed.delivery.method ?? "other";
  if (deliveryMethod === "np" && productLines.length > 0) {
    const restricted = await db
      .select({ name: products.name })
      .from(products)
      .where(
        and(
          inArray(
            products.code,
            productLines.map((line) => line.code),
          ),
          isNotNull(products.allowedDeliveryMethods),
        ),
      );
    if (restricted.length > 0) {
      deliveryMethod = "other";
      unclear.push(
        `${restricted[0]!.name} поштою не відправляємо: оберіть самовивіз або власну доставку.`,
      );
    }
  }

  const input: CreateOrderInput = {
    clientId,
    locationId: context.locationId,
    orderDate,
    iceTypeId: ice?.id ?? null,
    kgSold: parsed.kg_sold ?? 0,
    // «Фактично N кг» з повідомлення: це кг на виготовлення, а продане лишається як є (D162).
    ...(parsed.kg_to_produce != null && parsed.kg_to_produce > 0
      ? { kgToProduce: parsed.kg_to_produce.toFixed(3) }
      : {}),
    sourceId: source?.id ?? null,
    deliveryMethod,
    ...(boxSales.length > 0 ? { boxSales } : {}),
    ...(productLines.length > 0 ? { products: productLines } : {}),
    ...(deliveryMethod === "np" ? { npDeliveryKind: parsed.delivery.np_kind ?? "warehouse" } : {}),
    deliveryText: clip(deliveryText, 500),
    timeWindow: clip(parsed.delivery.time_window, 50),
    recipientName: clip(parsed.delivery.recipient_name, 100),
    recipientPhone,
    boxTypeId,
    boxCount: parsed.box.count ?? 0,
    boxOwnership: parsed.box.ownership ?? "ours",
    paymentKind: parsed.payment_hint ? PAYMENT_KINDS[parsed.payment_hint] : "unknown",
    comment: clip(parsed.comment, 2000),
  };
  // Ціна доставки з повідомлення стає платною доставкою (D161, D235); ціну боксів беремо з довідника.
  // Для Нової Пошти й самовивозу її не буває: лишаємо менеджеру підказку.
  if (parsed.delivery_price != null && parsed.delivery_price > 0) {
    if (canChargeDelivery(deliveryMethod)) input.deliveryPrice = parsed.delivery_price;
    else {
      unclear.push(
        `У повідомленні доставка ${parsed.delivery_price} грн, але для Нової Пошти й самовивозу її не додаємо. Перевірте спосіб доставки.`,
      );
    }
  }
  // Ціна за кг з повідомлення діє лише для нового клієнта (D161, Роман 20.11.2026: бот ставить її
  // сам): вона стає ціною чернетки з позначкою «вказано вручну». Коли клієнт відомий, його прайс
  // сильніший, а ціна з повідомлення лишається підказкою.
  if (parsed.price_per_kg != null && parsed.price_per_kg > 0) {
    if (isPlaceholder) {
      input.price = parsed.price_per_kg;
      unclear.push(
        `Ціну ${parsed.price_per_kg} грн/кг взято з повідомлення (новий клієнт). Перевірте її.`,
      );
    } else {
      unclear.push(
        `У повідомленні ціна ${parsed.price_per_kg} грн/кг; діє прайс клієнта, перевірте, чи збігається.`,
      );
    }
  }
  return { input, clientId, isPlaceholder, unclear };
}
