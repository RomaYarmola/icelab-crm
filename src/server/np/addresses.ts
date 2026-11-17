import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import { clientAddresses, clients, npCities, npWarehouses } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { parseInput, ValidationError } from "../errors";
import { type AppUser, requirePermission } from "../guards";

/**
 * Підбір адрес клієнтів у довідниках Нової Пошти (B10, D126, ТЗ 6.8): пошук міста й відділення в
 * нашій копії, ручне зіставлення адреси, автоматичне зіставлення наявних адрес і список адрес, що
 * «потребують уточнення». Без зіставлення накладну не створити.
 */

const SEARCH_LIMIT = 20;
const uuid = z.string().uuid();

export type NpCityOption = { ref: string; name: string; area: string | null };
export type NpWarehouseOption = { ref: string; name: string; number: string | null };

/** Екранує спецсимволи шаблону `ilike`. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, "\\$&")}%`;

/** Міста за частиною назви: спершу ті, що починаються з запиту. Лише активні. */
export async function searchNpCities(
  db: AnyPgDatabase,
  actor: AppUser,
  query: string,
): Promise<NpCityOption[]> {
  requirePermission(actor, "clients", "write");
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  const rows = await db
    .select({ ref: npCities.ref, name: npCities.nameUa, area: npCities.areaUa })
    .from(npCities)
    .where(and(eq(npCities.isActive, true), ilike(npCities.nameUa, likePattern(q))))
    .orderBy(
      sql`(case when lower(${npCities.nameUa}) = lower(${q}) then 0 when ${npCities.nameUa} ilike ${q.replace(/[\\%_]/g, "\\$&") + "%"} then 1 else 2 end)`,
      asc(npCities.nameUa),
    )
    .limit(SEARCH_LIMIT);
  return rows;
}

/** Відділення міста за номером чи частиною назви. Лише активні. Без запиту показує перші. */
export async function searchNpWarehouses(
  db: AnyPgDatabase,
  actor: AppUser,
  cityRef: string,
  query: string,
): Promise<NpWarehouseOption[]> {
  requirePermission(actor, "clients", "write");
  const city = parseInput(z.string().min(1).max(100), cityRef);
  const q = query.trim().slice(0, 60);
  const rows = await db
    .select({ ref: npWarehouses.ref, name: npWarehouses.nameUa, number: npWarehouses.number })
    .from(npWarehouses)
    .where(
      and(
        eq(npWarehouses.cityRef, city),
        eq(npWarehouses.isActive, true),
        q === ""
          ? undefined
          : or(
              eq(npWarehouses.number, q.replace(/^№\s*/, "")),
              ilike(npWarehouses.nameUa, likePattern(q)),
            ),
      ),
    )
    .orderBy(
      sql`nullif(regexp_replace(${npWarehouses.number}, '[^0-9]', '', 'g'), '')::bigint nulls last`,
    )
    .limit(SEARCH_LIMIT);
  return rows;
}

const resolveSchema = z.object({
  addressId: uuid,
  cityRef: z.string().min(1, "Оберіть місто.").max(100),
  warehouseRef: z.string().max(100).nullish(),
});

/**
 * Зіставляє адресу клієнта з довідником: «Склад Нової Пошти» потребує міста й відділення, «Адреса
 * Нової Пошти» (доставка за адресою) лише міста. Інші види адрес до Нової Пошти не належать.
 */
export async function resolveClientAddress(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof resolveSchema>,
): Promise<void> {
  requirePermission(actor, "clients", "write");
  const data = parseInput(resolveSchema, input);
  await withActor(db, actor.id, async (tx) => {
    const [address] = await tx
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.id, data.addressId));
    if (!address) throw new ValidationError("Адресу не знайдено.");
    if (address.kind !== "np_warehouse" && address.kind !== "np_address") {
      throw new ValidationError("Зіставляти з Новою Поштою можна лише адреси Нової Пошти.");
    }
    const [city] = await tx
      .select()
      .from(npCities)
      .where(and(eq(npCities.ref, data.cityRef), eq(npCities.isActive, true)));
    if (!city) throw new ValidationError("Місто не знайдено в довіднику.");

    let warehouse: typeof npWarehouses.$inferSelect | undefined;
    if (address.kind === "np_warehouse") {
      if (!data.warehouseRef) throw new ValidationError("Оберіть відділення.");
      [warehouse] = await tx
        .select()
        .from(npWarehouses)
        .where(
          and(
            eq(npWarehouses.ref, data.warehouseRef),
            eq(npWarehouses.cityRef, city.ref),
            eq(npWarehouses.isActive, true),
          ),
        );
      if (!warehouse) throw new ValidationError("Відділення не знайдено в цьому місті.");
    }
    await tx
      .update(clientAddresses)
      .set({
        npCityRef: city.ref,
        npWarehouseRef: warehouse?.ref ?? null,
        npWarehouseNumber: warehouse?.number ?? address.npWarehouseNumber,
        cityText: address.cityText ?? city.nameUa,
        isResolved: true,
      })
      .where(eq(clientAddresses.id, address.id));
  });
}

// ---------------------------------------------------------------------------------------------
// Автоматичне зіставлення і список «потребують уточнення»
// ---------------------------------------------------------------------------------------------

/** Назва міста для порівняння: без «м.», «місто», дужок, апострофів і регістру. */
export function normalizeCity(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/^\s*(м\.|місто|с\.|смт\.?|селище)\s*/u, "")
    .replace(/[’'`ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Номер відділення з тексту: «5», «№5», «відділення 12», «Відд. №7» → цифри. */
export function parseWarehouseNumber(text: string | null): string | null {
  if (!text) return null;
  const match = /(\d{1,6})/.exec(text);
  return match ? String(Number(match[1])) : null;
}

export type AutoResolveResult = { checked: number; resolved: number; needsReview: number };

/**
 * Проходить адреси Нової Пошти, які ще не зіставлені, і зіставляє ті, де збіг однозначний: одне
 * місто з такою назвою, а для складу ще й одне відділення з таким номером. Решта лишається для
 * ручного підбору. Лише власник.
 */
export async function autoResolveAddresses(
  db: AnyPgDatabase,
  actor: AppUser,
): Promise<AutoResolveResult> {
  requirePermission(actor, "migration_settings", "write");
  const pending = await db
    .select()
    .from(clientAddresses)
    .where(
      and(
        eq(clientAddresses.isResolved, false),
        inArray(clientAddresses.kind, ["np_warehouse", "np_address"]),
      ),
    );
  let resolved = 0;
  for (const address of pending) {
    const name = address.cityText ? normalizeCity(address.cityText) : "";
    if (!name) continue;
    const cities = await db
      .select({ ref: npCities.ref })
      .from(npCities)
      .where(and(eq(npCities.isActive, true), sql`lower(${npCities.nameUa}) = ${name}`))
      .limit(2);
    if (cities.length !== 1) continue;
    const cityRef = cities[0]!.ref;
    if (address.kind === "np_address") {
      await withActor(db, actor.id, (tx) =>
        tx
          .update(clientAddresses)
          .set({ npCityRef: cityRef, isResolved: true })
          .where(eq(clientAddresses.id, address.id)),
      );
      resolved += 1;
      continue;
    }
    const number = parseWarehouseNumber(address.npWarehouseNumber);
    if (!number) continue;
    const warehouses = await db
      .select({ ref: npWarehouses.ref })
      .from(npWarehouses)
      .where(
        and(
          eq(npWarehouses.cityRef, cityRef),
          eq(npWarehouses.isActive, true),
          eq(npWarehouses.number, number),
        ),
      )
      .limit(2);
    if (warehouses.length !== 1) continue;
    await withActor(db, actor.id, (tx) =>
      tx
        .update(clientAddresses)
        .set({
          npCityRef: cityRef,
          npWarehouseRef: warehouses[0]!.ref,
          npWarehouseNumber: number,
          isResolved: true,
        })
        .where(eq(clientAddresses.id, address.id)),
    );
    resolved += 1;
  }
  return { checked: pending.length, resolved, needsReview: pending.length - resolved };
}

export type UnresolvedAddress = {
  id: string;
  clientId: string;
  clientName: string;
  kindLabel: string;
  text: string;
};

/** Адреси Нової Пошти без зіставлення («потребують уточнення»), найновіші зміни першими. Лише власник. */
export async function listUnresolvedAddresses(
  db: AnyPgDatabase,
  actor: AppUser,
  limit = 50,
): Promise<{ total: number; items: UnresolvedAddress[] }> {
  requirePermission(actor, "migration_settings", "write");
  const where = and(
    eq(clientAddresses.isResolved, false),
    inArray(clientAddresses.kind, ["np_warehouse", "np_address"]),
    isNull(clients.deletedAt),
    ne(clients.isPlaceholder, true),
  );
  const [totalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientAddresses)
    .innerJoin(clients, eq(clients.id, clientAddresses.clientId))
    .where(where);
  const rows = await db
    .select({
      id: clientAddresses.id,
      clientId: clients.id,
      clientName: clients.name,
      kind: clientAddresses.kind,
      cityText: clientAddresses.cityText,
      addressText: clientAddresses.addressText,
      number: clientAddresses.npWarehouseNumber,
    })
    .from(clientAddresses)
    .innerJoin(clients, eq(clients.id, clientAddresses.clientId))
    .where(where)
    .orderBy(sql`${clientAddresses.updatedAt} desc`)
    .limit(Math.min(Math.max(limit, 1), 200));
  return {
    total: totalRow?.n ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.clientName,
      kindLabel: row.kind === "np_warehouse" ? "Склад Нової Пошти" : "Адреса Нової Пошти",
      text:
        [row.cityText, row.number ? `відділення № ${row.number}` : null, row.addressText]
          .filter(Boolean)
          .join(", ") || "Адреса не вказана",
    })),
  };
}
