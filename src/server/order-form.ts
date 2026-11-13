import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ADDRESS_KIND_LABELS } from "@/constants/clients";
import { clientAddresses } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { isIsoDate } from "@/utils/isoDate";
import { type ClientListItem } from "./client-views";
import { listClients } from "./clients";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission, requireRole } from "./guards";
import { DEFAULT_MARKUP_SETTINGS, type MarkupSettings, suggestMarkupPercent } from "./order-rules";
import { loadMarkupContext } from "./orders";
import { resolvePrice, type ResolvedPrice } from "./prices";

/**
 * Підказки для форми замовлення (D52, D53, D57): пошук клієнта, адреси клієнта і те, що система
 * підставить сама: ціна за прайсом і надбавка. Лише читання; користуються власник і менеджер, які
 * створюють замовлення.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const CLIENT_SEARCH_LIMIT = 8;

function requireOrderAuthor(actor: AppUser) {
  requirePermission(actor, "orders", "write", { anyLocation: true });
  requireRole(actor, "owner", "manager");
}

/** Клієнти для вибору в замовленні: код, назва, телефон (за кодом, назвою, телефоном чи контактом). */
export async function searchClientsForOrder(
  db: AnyPgDatabase,
  actor: AppUser,
  query: string,
): Promise<ClientListItem[]> {
  requireOrderAuthor(actor);
  const search = (typeof query === "string" ? query : "").trim();
  if (search.length < 2) return [];
  const page = await listClients(db, actor, { search, limit: CLIENT_SEARCH_LIMIT });
  return page.items;
}

export type ClientAddressOption = { id: string; text: string; isDefault: boolean };

/** Адреси клієнта для вибору в замовленні: вид і текст одним рядком, адреса за замовчуванням першою. */
export async function listClientAddressOptions(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<ClientAddressOption[]> {
  requireOrderAuthor(actor);
  const id = parseInput(uuid, clientId);
  const rows = await db
    .select()
    .from(clientAddresses)
    .where(eq(clientAddresses.clientId, id))
    .orderBy(desc(clientAddresses.isDefault), asc(clientAddresses.createdAt));
  return rows.map((row) => {
    const parts = [
      row.label,
      row.cityText,
      row.addressText,
      row.npWarehouseNumber ? `відділення № ${row.npWarehouseNumber}` : null,
    ].filter(Boolean);
    return {
      id: row.id,
      text: `${ADDRESS_KIND_LABELS[row.kind]}: ${parts.join(", ") || "без опису"}`,
      isDefault: row.isDefault,
    };
  });
}

export type OrderPricing = {
  /** Звідки ціна: ціна клієнта на тип льоду, ціна клієнта «для будь-якого», прайс чи ніде. */
  source: ResolvedPrice["source"] | "none";
  pricePerKg: string | null;
  /** Надбавка в відсотках для підказки «виготовити» (D53). */
  markupPercent: number;
  /** Кілограми й надбавка, з яких рахується підказка (для показу «+10%»). */
  markupSettings: MarkupSettings;
};

/**
 * Що система підставить у замовлення: ціна за прайсом (D52) і надбавка (D53) для клієнта, типу
 * льоду, дати й способу доставки. Це підказка для форми: справжні значення сервер рахує ще раз при
 * збереженні.
 */
export async function getOrderPricing(
  db: AnyPgDatabase,
  actor: AppUser,
  input: {
    clientId: string;
    iceTypeId?: string | null;
    orderDate: string;
    deliveryMethod?: string | null;
  },
): Promise<OrderPricing> {
  requireOrderAuthor(actor);
  const clientId = parseInput(uuid, input.clientId);
  const iceTypeId = input.iceTypeId ? parseInput(uuid, input.iceTypeId) : null;
  if (!isIsoDate(input.orderDate)) throw new ValidationError("Вкажіть дату замовлення.");

  const context = await loadMarkupContext(db, clientId);
  const resolved = iceTypeId
    ? await resolvePrice(db, { clientId, iceTypeId, date: input.orderDate })
    : null;
  return {
    source: resolved?.source ?? "none",
    pricePerKg: resolved?.pricePerKg ?? null,
    markupPercent: suggestMarkupPercent({
      deliveryMethod: input.deliveryMethod ?? "other",
      applicationCode: context.applicationCode,
      clientOverridePercent: context.markupOverride,
      settings: context.settings,
    }),
    markupSettings: context.settings ?? DEFAULT_MARKUP_SETTINGS,
  };
}
