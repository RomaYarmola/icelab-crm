import { and, eq, isNull, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { clients, orderSources } from "@/db/schema";
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
  if (parsed.kg_sold === null) unclear.push("Не вказано кілограмів.");

  const ice = parsed.ice_type
    ? context.dictionaries.iceTypes.find((type) => type.code === parsed.ice_type)
    : undefined;
  if (!ice) unclear.push("Не вказано тип льоду.");

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

  const input: CreateOrderInput = {
    clientId,
    locationId: context.locationId,
    orderDate,
    iceTypeId: ice?.id ?? null,
    kgSold: parsed.kg_sold ?? 0,
    sourceId: source?.id ?? null,
    deliveryMethod: parsed.delivery.method ?? "other",
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
  return { input, clientId, isPlaceholder, unclear };
}
