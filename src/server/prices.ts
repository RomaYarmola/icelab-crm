import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientPrices, clients, defaultPrices, iceTypes } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { todayIso } from "@/utils/isoDate";
import { parseInput, ValidationError } from "./errors";
import { type AppUser, requirePermission } from "./guards";
import { type OpenPrice, parsePriceDate, parsePricePerKg, planPriceChange } from "./price-rules";

/**
 * Ціни клієнтів і прайс (D26, D44, D45). Зміна ціни це завжди «нова ціна від дати»: чинна
 * закривається днем перед новою датою, нова додається, історія лишається. Ступенів за обсягом
 * немає (`min_kg = 0`). Усі записи йдуть через `withActor`, тож у журналі змін видно автора.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const ZERO_KG = "0";

export type PriceChangeInput = {
  pricePerKg: string | number;
  /** Дата YYYY-MM-DD, з якої діє ціна (можна майбутню). */
  validFrom: string;
};

export type ClientPriceChangeInput = PriceChangeInput & {
  clientId: string;
  /** Порожній тип льоду означає «для будь-якого типу». */
  iceTypeId?: string | null;
};

export type DefaultPriceChangeInput = PriceChangeInput & { iceTypeId: string };

export type ClientPriceRow = typeof clientPrices.$inferSelect;
export type DefaultPriceRow = typeof defaultPrices.$inferSelect;

async function assertIceType(db: AnyPgDatabase, iceTypeId: string) {
  const [row] = await db
    .select({ id: iceTypes.id, isActive: iceTypes.isActive })
    .from(iceTypes)
    .where(eq(iceTypes.id, iceTypeId))
    .limit(1);
  if (!row) throw new ValidationError("Тип льоду не знайдено.");
  if (!row.isActive) throw new ValidationError("Цей тип льоду вимкнено.");
}

function toOpenPrice(row: { id: string; pricePerKg: string; validFrom: string }): OpenPrice {
  return { id: row.id, pricePerKg: row.pricePerKg, validFrom: row.validFrom };
}

/** Ціна клієнта «нова ціна від дати» (D45). Повертає чинну (відкриту) ціну після зміни. */
export async function changeClientPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  input: ClientPriceChangeInput,
): Promise<ClientPriceRow> {
  requirePermission(actor, "client_prices", "write");
  const clientId = parseInput(uuid, input.clientId);
  const iceTypeId = input.iceTypeId ? parseInput(uuid, input.iceTypeId) : null;
  const pricePerKg = parsePricePerKg(input.pricePerKg);
  const validFrom = parsePriceDate(input.validFrom);

  const [client] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new ValidationError("Клієнта не знайдено.");
  if (client.deletedAt) throw new ValidationError("Клієнта видалено: змінювати ціни не можна.");
  if (iceTypeId) await assertIceType(db, iceTypeId);

  return withActor(db, actor.id, async (tx) => {
    const [open] = await tx
      .select()
      .from(clientPrices)
      .where(
        and(
          eq(clientPrices.clientId, clientId),
          iceTypeId ? eq(clientPrices.iceTypeId, iceTypeId) : isNull(clientPrices.iceTypeId),
          eq(clientPrices.minKg, ZERO_KG),
          isNull(clientPrices.validTo),
        ),
      )
      .for("update");

    const plan = planPriceChange({ open: open ? toOpenPrice(open) : null, pricePerKg, validFrom });

    if (plan.kind === "correct") {
      const [row] = await tx
        .update(clientPrices)
        .set({ pricePerKg })
        .where(eq(clientPrices.id, plan.id))
        .returning();
      return row!;
    }
    if (plan.kind === "replace") {
      await tx
        .update(clientPrices)
        .set({ validTo: plan.closeTo })
        .where(eq(clientPrices.id, plan.closeId));
    }
    const [row] = await tx
      .insert(clientPrices)
      .values({ clientId, iceTypeId, pricePerKg, minKg: ZERO_KG, validFrom: plan.validFrom })
      .returning();
    return row!;
  });
}

/** Ціна прайсу (за замовчуванням) «нова ціна від дати». Лише власник (D44). */
export async function changeDefaultPrice(
  db: AnyPgDatabase,
  actor: AppUser,
  input: DefaultPriceChangeInput,
): Promise<DefaultPriceRow> {
  requirePermission(actor, "default_prices", "write");
  const iceTypeId = parseInput(uuid, input.iceTypeId);
  const pricePerKg = parsePricePerKg(input.pricePerKg);
  const validFrom = parsePriceDate(input.validFrom);
  await assertIceType(db, iceTypeId);

  return withActor(db, actor.id, async (tx) => {
    const [open] = await tx
      .select()
      .from(defaultPrices)
      .where(
        and(
          eq(defaultPrices.iceTypeId, iceTypeId),
          eq(defaultPrices.minKg, ZERO_KG),
          isNull(defaultPrices.validTo),
        ),
      )
      .for("update");

    const plan = planPriceChange({ open: open ? toOpenPrice(open) : null, pricePerKg, validFrom });

    if (plan.kind === "correct") {
      const [row] = await tx
        .update(defaultPrices)
        .set({ pricePerKg })
        .where(eq(defaultPrices.id, plan.id))
        .returning();
      return row!;
    }
    if (plan.kind === "replace") {
      await tx
        .update(defaultPrices)
        .set({ validTo: plan.closeTo })
        .where(eq(defaultPrices.id, plan.closeId));
    }
    const [row] = await tx
      .insert(defaultPrices)
      .values({ iceTypeId, pricePerKg, minKg: ZERO_KG, validFrom: plan.validFrom })
      .returning();
    return row!;
  });
}

export type ClientPriceHistoryItem = {
  id: string;
  iceTypeId: string | null;
  iceTypeName: string | null;
  pricePerKg: string;
  validFrom: string;
  validTo: string | null;
};

/** Уся історія цін клієнта: за типами льоду, у кожному від новішої до старішої. */
export async function listClientPrices(
  db: AnyPgDatabase,
  actor: AppUser,
  clientId: string,
): Promise<ClientPriceHistoryItem[]> {
  requirePermission(actor, "client_prices", "read");
  const id = parseInput(uuid, clientId);
  return db
    .select({
      id: clientPrices.id,
      iceTypeId: clientPrices.iceTypeId,
      iceTypeName: iceTypes.name,
      pricePerKg: clientPrices.pricePerKg,
      validFrom: clientPrices.validFrom,
      validTo: clientPrices.validTo,
    })
    .from(clientPrices)
    .leftJoin(iceTypes, eq(iceTypes.id, clientPrices.iceTypeId))
    .where(and(eq(clientPrices.clientId, id), eq(clientPrices.minKg, ZERO_KG)))
    .orderBy(sql`${iceTypes.sort} asc nulls first`, desc(clientPrices.validFrom));
}

export type DefaultPriceHistoryItem = {
  id: string;
  iceTypeId: string;
  iceTypeName: string;
  pricePerKg: string;
  validFrom: string;
  validTo: string | null;
};

/** Уся історія прайсу за типами льоду (для екрана «Прайс»). */
export async function listDefaultPrices(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<DefaultPriceHistoryItem[]> {
  requirePermission(actor, "default_prices", "read");
  return db
    .select({
      id: defaultPrices.id,
      iceTypeId: defaultPrices.iceTypeId,
      iceTypeName: iceTypes.name,
      pricePerKg: defaultPrices.pricePerKg,
      validFrom: defaultPrices.validFrom,
      validTo: defaultPrices.validTo,
    })
    .from(defaultPrices)
    .innerJoin(iceTypes, eq(iceTypes.id, defaultPrices.iceTypeId))
    .where(eq(defaultPrices.minKg, ZERO_KG))
    .orderBy(asc(iceTypes.sort), desc(defaultPrices.validFrom));
}

export type ResolvedPrice = {
  /** Звідки ціна: індивідуальна на цей тип, індивідуальна «для будь-якого типу» або прайс. */
  source: "client" | "client_any_type" | "default";
  pricePerKg: string;
  validFrom: string;
};

/**
 * Яка ціна за кг діє для клієнта, типу льоду і дати (ТЗ §7.1, D45): індивідуальна на цей тип,
 * інакше індивідуальна «для будь-якого типу», інакше прайс. `null`, якщо ціни немає ніде.
 *
 * Функція без перевірки прав: її викликає серверний код замовлень (B5), який сам вирішує,
 * що показувати ролі. Ціну віддавати в браузер можна лише ролям з правом на ціни.
 */
export async function resolvePrice(
  db: AnyPgDatabase,
  input: { clientId: string; iceTypeId: string; date?: string },
): Promise<ResolvedPrice | null> {
  const date = input.date ?? todayIso();
  const active = <T extends { validFrom: unknown; validTo: unknown }>(table: T) =>
    sql`${table.validFrom} <= ${date} and (${table.validTo} is null or ${table.validTo} >= ${date})`;

  const clientRow = async (iceTypeCondition: ReturnType<typeof eq> | ReturnType<typeof isNull>) => {
    const [row] = await db
      .select({ pricePerKg: clientPrices.pricePerKg, validFrom: clientPrices.validFrom })
      .from(clientPrices)
      .where(
        and(
          eq(clientPrices.clientId, input.clientId),
          iceTypeCondition,
          eq(clientPrices.minKg, ZERO_KG),
          active(clientPrices),
        ),
      )
      .orderBy(desc(clientPrices.validFrom))
      .limit(1);
    return row ?? null;
  };

  const exact = await clientRow(eq(clientPrices.iceTypeId, input.iceTypeId));
  if (exact) return { source: "client", ...exact };

  const anyType = await clientRow(isNull(clientPrices.iceTypeId));
  if (anyType) return { source: "client_any_type", ...anyType };

  const [fallback] = await db
    .select({ pricePerKg: defaultPrices.pricePerKg, validFrom: defaultPrices.validFrom })
    .from(defaultPrices)
    .where(
      and(
        eq(defaultPrices.iceTypeId, input.iceTypeId),
        eq(defaultPrices.minKg, ZERO_KG),
        active(defaultPrices),
      ),
    )
    .orderBy(desc(defaultPrices.validFrom))
    .limit(1);
  return fallback ? { source: "default", ...fallback } : null;
}
