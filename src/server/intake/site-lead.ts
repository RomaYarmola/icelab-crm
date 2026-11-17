import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientContacts, clients, orders, profiles, siteLeads } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { normalizePhone } from "@/utils/phone";
import { createOrder } from "../orders";
import type { AppUser } from "../guards";
import { buildDraft } from "./draft";
import { kyivDay, loadDictionaries } from "./prompt";
import { locations } from "@/db/schema";
import type { ParseResult } from "./schema";

/**
 * Заявки з форми на сайті icelab.com.ua (B11, ТЗ 8.1, D141, D146): сайт надсилає `{lead, message,
 * receivedAt}`, а ми створюємо чернетку замовлення з джерелом «Сайт». Позиції розбираємо простими
 * правилами (без Claude): рядок із «3/16/19 мм» і кілограмами це лід, решта йде в коментар.
 * Клієнта шукаємо за телефоном; не знайдений чи їх кілька: чернетка отримує «Новий клієнт», а
 * справжнього обирає менеджер (нового автоматично не створюємо). Однакова заявка (той самий телефон у
 * межах 10 хвилин) повторно чернетку не створює.
 */

const DEDUPE_WINDOW_MS = 10 * 60_000;

const numberLike = z.union([z.number(), z.string()]);

const itemSchema = z
  .object({
    title: z.string().max(300).optional(),
    quantity: numberLike.optional(),
    unit: z.string().max(30).optional(),
    price: numberLike.optional(),
  })
  .passthrough();

export const siteLeadSchema = z.object({
  lead: z
    .object({
      /** «замовлення», «заявка», «консультація». */
      type: z.string().max(60).optional(),
      name: z.string().max(200).optional(),
      phone: z.string().min(1, "Вкажіть телефон.").max(40),
      messenger: z.string().max(60).optional(),
      /** Спосіб отримання: «Самовивіз зі складу у Львові», «Нова Пошта», «Доставка». */
      delivery: z.string().max(300).optional(),
      comment: z.string().max(2000).optional(),
      items: z.array(itemSchema).max(30).optional(),
    })
    .passthrough(),
  message: z.string().max(4000).optional(),
  receivedAt: z.string().max(40).optional(),
});

export type SiteLeadBody = z.infer<typeof siteLeadSchema>;

export type SiteLeadResult =
  | { ok: true; draftId: string; duplicate: boolean }
  | { ok: false; status: 400 | 422 | 503; error: string };

const num = (value: number | string | undefined): number | null => {
  if (value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Ключ дублікату: телефон і десятихвилинне вікно (ТЗ 4.7). */
export function dedupeKey(phone: string, at: Date): string {
  const bucket = Math.floor(at.getTime() / DEDUPE_WINDOW_MS);
  return createHash("sha256").update(`${phone}|${bucket}`).digest("hex");
}

const ICE_FROM_TITLE = /(?:^|[^\d])(3|16|19)\s*(?:мм|mm)/i;

/** Спосіб доставки за текстом способу отримання. */
export function methodFromText(text: string | undefined): ParseResult["delivery"]["method"] {
  const value = (text ?? "").toLowerCase();
  if (!value) return null;
  if (value.includes("самовивіз")) return "pickup";
  if (value.includes("нова пошта") || value.includes("новою поштою") || value.includes("нп "))
    return "np";
  if (value.includes("автобус")) return "bus";
  if (value.includes("достав") || value.includes("кур'єр") || value.includes("курьер"))
    return "our_delivery";
  return "other";
}

/** Локація заявки: львівський склад чи місто Львів у способі отримання, інакше Київ (D146). */
export function locationFromText(text: string | undefined): "kyiv" | "lviv" {
  return /льв[іо]в/i.test(text ?? "") ? "lviv" : "kyiv";
}

/** Лід (кг і тип) і решта позицій текстом із рядків заявки. */
export function summarizeItems(items: z.infer<typeof itemSchema>[] | undefined) {
  let kg = 0;
  let ice: ParseResult["ice_type"] = null;
  const rest: string[] = [];
  for (const item of items ?? []) {
    const title = (item.title ?? "").trim();
    const quantity = num(item.quantity);
    const match = ICE_FROM_TITLE.exec(title);
    const code = match ? (`${match[1]}mm` as "3mm" | "16mm" | "19mm") : null;
    if (code && quantity !== null && (!ice || ice === code)) {
      ice = code;
      kg += quantity;
    } else if (title || quantity !== null) {
      rest.push(
        [title, quantity !== null ? `× ${quantity}` : null, item.unit].filter(Boolean).join(" "),
      );
    }
  }
  return { kg: kg > 0 ? kg : null, ice, rest };
}

/** Автор чернеток із сайту: перший активний власник (замовлення створює система від його імені). */
async function systemAuthor(db: AnyPgDatabase): Promise<AppUser | null> {
  const [owner] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.role, "owner"), eq(profiles.isActive, true)))
    .orderBy(asc(profiles.createdAt))
    .limit(1);
  if (!owner) return null;
  return {
    id: owner.id,
    email: null,
    fullName: owner.fullName,
    role: "owner",
    locationId: null,
    locationName: null,
  };
}

/** Єдиний активний клієнт із цим телефоном; кілька чи жодного: `null`. */
async function clientByPhone(
  db: AnyPgDatabase,
  phone: string,
): Promise<{ id: string; code: string } | null> {
  const rows = await db
    .selectDistinct({ id: clients.id, code: clients.code })
    .from(clientContacts)
    .innerJoin(clients, eq(clients.id, clientContacts.clientId))
    .where(
      and(
        eq(clientContacts.phone, phone),
        isNull(clients.deletedAt),
        eq(clients.isPlaceholder, false),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

/** Перевірка тіла запиту без бази: схема й телефон. `null`, якщо все гаразд. */
export function validateSiteLead(body: unknown): Extract<SiteLeadResult, { ok: false }> | null {
  const parsed = siteLeadSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Некоректний запит.",
    };
  }
  if (!normalizePhone(parsed.data.lead.phone)) {
    return { ok: false, status: 422, error: "Не вдалося розпізнати телефон." };
  }
  return null;
}

/** Приймає заявку з сайту й створює чернетку. Не кидає помилок введення: повертає результат. */
export async function receiveSiteLead(
  db: AnyPgDatabase,
  body: unknown,
  options: { now?: Date } = {},
): Promise<SiteLeadResult> {
  const parsedBody = siteLeadSchema.safeParse(body);
  if (!parsedBody.success) {
    return {
      ok: false,
      status: 400,
      error: parsedBody.error.issues[0]?.message ?? "Некоректний запит.",
    };
  }
  const { lead, message, receivedAt } = parsedBody.data;
  const phone = normalizePhone(lead.phone);
  if (!phone) return { ok: false, status: 422, error: "Не вдалося розпізнати телефон." };

  const now = options.now ?? new Date();
  const received = receivedAt && !Number.isNaN(Date.parse(receivedAt)) ? new Date(receivedAt) : now;
  const key = dedupeKey(phone, received);

  const [existing] = await db.select().from(siteLeads).where(eq(siteLeads.dedupeKey, key));
  if (existing) {
    return existing.orderId
      ? { ok: true, draftId: existing.orderId, duplicate: true }
      : { ok: false, status: 503, error: "Заявку вже приймають, повторіть пізніше." };
  }
  const author = await systemAuthor(db);
  if (!author) return { ok: false, status: 503, error: "У системі немає активного власника." };

  // Запис про заявку й чернетка в одній транзакції: або обоє, або жодного.
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AnyPgDatabase;
    const inserted = await tx
      .insert(siteLeads)
      .values({ payload: parsedBody.data, dedupeKey: key, receivedAt: received })
      .onConflictDoNothing()
      .returning({ id: siteLeads.id });
    if (inserted.length === 0) {
      const [again] = await tx.select().from(siteLeads).where(eq(siteLeads.dedupeKey, key));
      return again?.orderId
        ? { ok: true as const, draftId: again.orderId, duplicate: true }
        : {
            ok: false as const,
            status: 503 as const,
            error: "Заявку вже приймають, повторіть пізніше.",
          };
    }

    const locationCode = locationFromText(lead.delivery);
    const [location] = await tx.select().from(locations).where(eq(locations.code, locationCode));
    if (!location)
      return { ok: false as const, status: 503 as const, error: "Локацію не знайдено." };

    const client = await clientByPhone(txDb, phone);
    const items = summarizeItems(lead.items);
    const notes = [
      lead.type && lead.type.toLowerCase() !== "замовлення" ? `Тип заявки: ${lead.type}.` : null,
      lead.comment?.trim() || null,
      items.rest.length > 0 ? `Позиції: ${items.rest.join("; ")}.` : null,
      lead.messenger ? `Месенджер: ${lead.messenger}.` : null,
      message && !lead.comment ? `Повідомлення: ${message.slice(0, 500)}` : null,
    ].filter(Boolean);

    const method = methodFromText(lead.delivery);
    const parsed: ParseResult = {
      client: client
        ? { code: client.code, name_guess: lead.name ?? null, confidence: 1 }
        : { code: null, name_guess: lead.name ?? null, confidence: 0 },
      order_date: null,
      kg_sold: items.kg,
      ice_type: items.ice,
      box: { type_code: null, count: null, ownership: null },
      delivery: {
        method,
        city: null,
        np_warehouse_number: null,
        address: method === "np" || method === "our_delivery" ? (lead.delivery ?? null) : null,
        time_window: null,
        recipient_name: lead.name ?? null,
        recipient_phone: phone,
      },
      payment_hint: null,
      comment: notes.join(" ") || null,
      unclear: ["Заявка з сайту: перевірте позиції й клієнта."],
    };
    const draft = await buildDraft(txDb, parsed, {
      locationId: location.id,
      messageDay: kyivDay(received),
      dictionaries: await loadDictionaries(txDb),
      sourceCode: "site",
    });
    const created = await createOrder(txDb, author, draft.input);
    await withActor(txDb, author.id, (inner) =>
      inner
        .update(orders)
        .set({
          draftPayload: {
            source: "site",
            unclear: draft.unclear,
            isPlaceholder: draft.isPlaceholder,
            siteLeadId: inserted[0]!.id,
          },
        })
        .where(eq(orders.id, created.id)),
    );
    await tx
      .update(siteLeads)
      .set({ orderId: created.id })
      .where(eq(siteLeads.id, inserted[0]!.id));
    return { ok: true as const, draftId: created.id, duplicate: false };
  });
}
