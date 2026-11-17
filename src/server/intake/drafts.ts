import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  boxTypes,
  clients,
  iceTypes,
  intakeMessages,
  locations,
  orders,
  profiles,
  siteLeads,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { DELIVERY_METHOD_LABELS } from "@/constants/orders";
import { ValidationError } from "../errors";
import { ForbiddenError, type AppUser, locationScope, requirePermission } from "../guards";
import { deleteDraftOrder } from "../orders";
import { transitionOrder } from "../order-status";
import { notifyOrderChange } from "../production-signal";
import { notifyOrderConfirmed } from "../telegram/notify";

/**
 * Вкладка «Чернетки» (B11, ТЗ 6.9): чернетки замовлень, створені з Telegram і з сайту, з вихідним
 * текстом заявки й тим, що розпізнано. Підтверджують, виправляють і відхиляють власник і менеджер.
 */

function assertOffice(actor: AppUser): void {
  requirePermission(actor, "orders", "write", { anyLocation: true });
  if (actor.role !== "owner" && actor.role !== "manager") throw new ForbiddenError();
}

export type IntakeDraft = {
  orderId: string;
  number: number | null;
  clientId: string;
  clientName: string;
  /** Клієнта не визначено: підтвердити не можна. */
  isPlaceholder: boolean;
  locationName: string;
  orderDate: string;
  kgSold: string;
  iceName: string | null;
  deliveryLabel: string;
  deliveryText: string | null;
  timeWindow: string | null;
  boxText: string | null;
  comment: string | null;
  unclear: string[];
  source: "telegram" | "site";
  /** Вихідний текст заявки: повідомлення групи чи зведення форми сайту. */
  sourceText: string;
  createdAt: string;
  authorName: string | null;
};

/** Чернетки із заявок (є `draft_payload`), найновіші першими. Менеджер і власник бачать усі локації. */
export async function listIntakeDrafts(
  db: AnyPgDatabase,
  actor: AppUser,
  options: { locationId?: string | null; limit?: number } = {},
): Promise<IntakeDraft[]> {
  assertOffice(actor);
  const own = locationScope(actor);
  const locationId = own ?? options.locationId ?? null;
  const rows = await db
    .select({
      order: orders,
      clientName: clients.name,
      isPlaceholder: clients.isPlaceholder,
      locationName: locations.name,
      iceName: iceTypes.name,
      boxName: boxTypes.name,
      authorName: profiles.fullName,
      messageText: sql<
        string | null
      >`(select m.text from ${intakeMessages} m where m.order_id = ${orders.id} limit 1)`,
      leadPayload: sql<unknown>`(select l.payload from ${siteLeads} l where l.order_id = ${orders.id} limit 1)`,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .innerJoin(locations, eq(locations.id, orders.locationId))
    .leftJoin(iceTypes, eq(iceTypes.id, orders.iceTypeId))
    .leftJoin(boxTypes, eq(boxTypes.id, orders.boxTypeId))
    .leftJoin(profiles, eq(profiles.id, orders.createdBy))
    .where(
      and(
        eq(orders.status, "draft"),
        isNull(orders.deletedAt),
        isNotNull(orders.draftPayload),
        locationId ? eq(orders.locationId, locationId) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));

  return rows.map((row) => {
    const payload = row.order.draftPayload as { unclear?: string[]; source?: string } | null;
    const isSite = payload?.source === "site" || row.leadPayload !== null;
    const lead = row.leadPayload as { lead?: Record<string, unknown>; message?: string } | null;
    const sourceText = isSite
      ? [
          lead?.lead?.name ? `Ім'я: ${String(lead.lead.name)}` : null,
          lead?.lead?.phone ? `Телефон: ${String(lead.lead.phone)}` : null,
          lead?.lead?.delivery ? `Отримання: ${String(lead.lead.delivery)}` : null,
          lead?.message ?? null,
        ]
          .filter(Boolean)
          .join("\n")
      : (row.messageText ?? "");
    return {
      orderId: row.order.id,
      number: row.order.number,
      clientId: row.order.clientId,
      clientName: row.clientName,
      isPlaceholder: row.isPlaceholder,
      locationName: row.locationName,
      orderDate: row.order.orderDate,
      kgSold: row.order.kgSold,
      iceName: row.iceName,
      deliveryLabel: DELIVERY_METHOD_LABELS[row.order.deliveryMethod],
      deliveryText: row.order.deliveryText,
      timeWindow: row.order.timeWindow,
      boxText:
        row.boxName && row.order.boxCount > 0 ? `${row.order.boxCount} × ${row.boxName}` : null,
      comment: row.order.comment,
      unclear: payload?.unclear ?? [],
      source: isSite ? "site" : "telegram",
      sourceText,
      createdAt: row.order.createdAt.toISOString(),
      authorName: row.authorName,
    };
  });
}

/** Скільки чернеток чекає підтвердження (для лічильника на вкладці). */
export async function countIntakeDrafts(db: AnyPgDatabase, actor: AppUser): Promise<number> {
  assertOffice(actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(eq(orders.status, "draft"), isNull(orders.deletedAt), isNotNull(orders.draftPayload)),
    );
  return row?.n ?? 0;
}

/** Позначає повідомлення-заявку, з якого вийшла чернетка (для історії приймання). */
export async function settleIntakeMessage(
  db: AnyPgDatabase,
  orderId: string,
  status: "confirmed" | "rejected",
): Promise<void> {
  await db
    .update(intakeMessages)
    .set({ parseStatus: status })
    .where(eq(intakeMessages.orderId, orderId));
}

/** «Підтвердити» з CRM: ті самі правила, що й у кнопці Telegram (клієнт обов'язковий, ціна за прайсом). */
export async function confirmIntakeDraft(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<void> {
  assertOffice(actor);
  await transitionOrder(db, actor, orderId, "confirmed");
  await settleIntakeMessage(db, orderId, "confirmed");
  notifyOrderChange(db, orderId);
  notifyOrderConfirmed(db, orderId, actor.id);
}

/** «Відхилити» з CRM: чернетка видаляється, заявка лишається в історії зі статусом «відхилено». */
export async function rejectIntakeDraft(
  db: AnyPgDatabase,
  actor: AppUser,
  orderId: string,
): Promise<void> {
  assertOffice(actor);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.deletedAt) throw new ValidationError("Чернетку вже відхилено.");
  await deleteDraftOrder(db, actor, orderId);
  await settleIntakeMessage(db, orderId, "rejected");
}
