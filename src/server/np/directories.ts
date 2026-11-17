import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { clientAddresses, npCities, npSyncState, npWarehouses } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { type AppUser, requirePermission } from "../guards";
import { callNp, type NpCall } from "./client";

/**
 * Оновлення довідників міст і відділень Нової Пошти (B10, D125, ТЗ 8.4). Відділень понад 30 тисяч,
 * а функція на безкоштовному Vercel живе недовго, тому кожен виклик бере кілька сторінок і
 * запам'ятовує, де зупинився (`np_sync_state`). Повний прогін: міста, потім відділення, потім
 * підсумок: що не прийшло цього разу, стає неактивним, а адреси клієнтів на таких відділеннях
 * знову «потребують уточнення». Усі записи ідемпотентні: повторне завантаження сторінки нічого не
 * ламає, тож одночасний ручний і розкладний запуски безпечні.
 */

export const NP_PAGE_SIZE = 500;
/** Скільки сторінок за один виклик (кожна це один запит до Нової Пошти, до 1–2 секунд). */
export const DEFAULT_MAX_PAGES = 4;
/** Скільки часу даємо одному виклику, мс: на безкоштовному Vercel функція живе до 10 секунд. */
export const DEFAULT_BUDGET_MS = 7_000;
/** Свіжими вважаємо довідники, оновлені менш ніж 20 годин тому: розклад не крутить зайвого. */
export const FRESH_HOURS = 20;
/** Прогін, що завис довше за цей час, починаємо заново. */
const STALE_RUN_HOURS = 6;
const STATE_KEY = "directories";

export type SyncPhase = "idle" | "cities" | "warehouses";

export type SyncStatus = {
  phase: SyncPhase;
  page: number;
  lastFinishedAt: string | null;
  citiesCount: number;
  warehousesCount: number;
  /** Скільки міст і відділень у копії зараз. */
  storedCities: number;
  storedWarehouses: number;
};

export type SyncResult = {
  /** `fresh`: оновлювати рано; `progress`: ще є що завантажувати; `done`: прогін завершено. */
  status: "fresh" | "progress" | "done";
  phase: SyncPhase;
  page: number;
  message: string;
};

type RawCity = { Ref?: string; Description?: string; AreaDescription?: string };
type RawWarehouse = {
  Ref?: string;
  Description?: string;
  Number?: string;
  TypeOfWarehouse?: string;
  CityRef?: string;
  WarehouseStatus?: string;
};

type Options = {
  now?: Date;
  maxPages?: number;
  budgetMs?: number;
  /** Не чекати «свіжості»: ручний запуск власника. */
  force?: boolean;
  /** Підміна `fetch` і ключа для тестів. */
  api?: Parameters<typeof callNp>[2];
};

async function loadState(db: AnyPgDatabase) {
  const [row] = await db.select().from(npSyncState).where(eq(npSyncState.key, STATE_KEY));
  return row ?? null;
}

async function saveState(
  db: AnyPgDatabase,
  patch: Partial<typeof npSyncState.$inferInsert>,
): Promise<void> {
  await db
    .insert(npSyncState)
    .values({ key: STATE_KEY, ...patch })
    .onConflictDoUpdate({ target: npSyncState.key, set: { ...patch, updatedAt: new Date() } });
}

/** Стан для екрана: фаза, дата останнього оновлення, скільки записів у копії. */
export async function getSyncStatus(db: AnyPgDatabase): Promise<SyncStatus> {
  const state = await loadState(db);
  const [cities, warehouses] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(npCities),
    db.select({ n: sql<number>`count(*)::int` }).from(npWarehouses),
  ]);
  return {
    phase: (state?.phase as SyncPhase | undefined) ?? "idle",
    page: state?.page ?? 1,
    lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
    citiesCount: state?.citiesCount ?? 0,
    warehousesCount: state?.warehousesCount ?? 0,
    storedCities: cities[0]?.n ?? 0,
    storedWarehouses: warehouses[0]?.n ?? 0,
  };
}

async function upsertCities(db: AnyPgDatabase, rows: RawCity[]): Promise<number> {
  const values = rows
    .filter((row): row is RawCity & { Ref: string; Description: string } =>
      Boolean(row.Ref && row.Description),
    )
    .map((row) => ({
      ref: row.Ref,
      nameUa: row.Description.trim(),
      areaUa: row.AreaDescription?.trim() || null,
      isActive: true,
      syncedAt: new Date(),
    }));
  if (values.length === 0) return 0;
  await db
    .insert(npCities)
    .values(values)
    .onConflictDoUpdate({
      target: npCities.ref,
      set: {
        nameUa: sql`excluded.name_ua`,
        areaUa: sql`excluded.area_ua`,
        isActive: true,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  return values.length;
}

async function upsertWarehouses(db: AnyPgDatabase, rows: RawWarehouse[]): Promise<number> {
  const values = rows
    .filter((row): row is RawWarehouse & { Ref: string; Description: string; CityRef: string } =>
      Boolean(row.Ref && row.Description && row.CityRef),
    )
    .map((row) => ({
      ref: row.Ref,
      cityRef: row.CityRef,
      nameUa: row.Description.trim(),
      number: row.Number?.trim() || null,
      type: row.TypeOfWarehouse?.trim() || null,
      // Відділення, що тимчасово не працює, для вибору не пропонуємо.
      isActive: row.WarehouseStatus ? row.WarehouseStatus === "Working" : true,
      syncedAt: new Date(),
    }));
  if (values.length === 0) return 0;
  await db
    .insert(npWarehouses)
    .values(values)
    .onConflictDoUpdate({
      target: npWarehouses.ref,
      set: {
        cityRef: sql`excluded.city_ref`,
        nameUa: sql`excluded.name_ua`,
        number: sql`excluded.number`,
        type: sql`excluded.type`,
        isActive: sql`excluded.is_active`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  return values.length;
}

/**
 * Підсумок прогону: не оновлені цього разу записи стають неактивними, а зіставлені адреси клієнтів,
 * що вказують на неактивне чи зниле відділення, знову «потребують уточнення» (ТЗ 8.4).
 */
async function finalize(db: AnyPgDatabase, runStart: Date): Promise<number> {
  await db.update(npCities).set({ isActive: false }).where(lt(npCities.syncedAt, runStart));
  await db.update(npWarehouses).set({ isActive: false }).where(lt(npWarehouses.syncedAt, runStart));
  const broken = await db
    .select({ id: clientAddresses.id })
    .from(clientAddresses)
    .leftJoin(npWarehouses, eq(npWarehouses.ref, clientAddresses.npWarehouseRef))
    .where(
      and(
        eq(clientAddresses.isResolved, true),
        isNotNull(clientAddresses.npWarehouseRef),
        sql`(${npWarehouses.ref} is null or ${npWarehouses.isActive} = false)`,
      ),
    );
  if (broken.length > 0) {
    await withActor(db, null, async (tx) => {
      await tx
        .update(clientAddresses)
        .set({ isResolved: false })
        .where(
          inArray(
            clientAddresses.id,
            broken.map((row) => row.id),
          ),
        );
    });
  }
  return broken.length;
}

/**
 * Один виклик оновлення: продовжує початий прогін або починає новий (якщо довідники застаріли чи
 * `force`). Повертає, чи треба ще викликати. Помилка Нової Пошти кидається далі, а стан
 * лишається на тій сторінці, що не вдалась: наступний виклик почне з неї.
 */
export async function runDirectorySync(
  db: AnyPgDatabase,
  options: Options = {},
): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  let state = await loadState(db);
  const running = state && state.phase !== "idle" && state.runStartedAt;
  const stale =
    running && now.getTime() - state!.runStartedAt!.getTime() > STALE_RUN_HOURS * 3_600_000;

  if (!running || stale) {
    const finished = state?.lastFinishedAt;
    if (
      !options.force &&
      finished &&
      now.getTime() - finished.getTime() < FRESH_HOURS * 3_600_000
    ) {
      return {
        status: "fresh",
        phase: "idle",
        page: 1,
        message: "Довідники оновлені менш ніж добу тому.",
      };
    }
    await saveState(db, { phase: "cities", page: 1, runStartedAt: now });
    state = await loadState(db);
  }

  const runStart = state!.runStartedAt!;
  let phase = state!.phase as SyncPhase;
  let page = state!.page;
  let citiesTotal = state!.citiesCount;
  let warehousesTotal = state!.warehousesCount;
  if (page === 1 && phase === "cities") {
    citiesTotal = 0;
    warehousesTotal = 0;
  }

  for (let step = 0; step < maxPages && Date.now() < deadline; step += 1) {
    const call: NpCall =
      phase === "cities"
        ? {
            modelName: "Address",
            calledMethod: "getCities",
            methodProperties: { Page: String(page), Limit: String(NP_PAGE_SIZE) },
          }
        : {
            modelName: "Address",
            calledMethod: "getWarehouses",
            methodProperties: { Page: String(page), Limit: String(NP_PAGE_SIZE) },
          };
    const { data } = await callNp<RawCity & RawWarehouse>(db, call, options.api);

    if (phase === "cities") citiesTotal += await upsertCities(db, data);
    else warehousesTotal += await upsertWarehouses(db, data);

    const isLastPage = data.length < NP_PAGE_SIZE;
    if (!isLastPage) {
      page += 1;
    } else if (phase === "cities") {
      phase = "warehouses";
      page = 1;
    } else {
      const broken = await finalize(db, runStart);
      await saveState(db, {
        phase: "idle",
        page: 1,
        lastFinishedAt: new Date(),
        citiesCount: citiesTotal,
        warehousesCount: warehousesTotal,
      });
      return {
        status: "done",
        phase: "idle",
        page: 1,
        message:
          `Довідники оновлено: міст ${citiesTotal}, відділень ${warehousesTotal}.` +
          (broken > 0 ? ` Адрес, що потребують уточнення: ${broken}.` : ""),
      };
    }
    await saveState(db, {
      phase,
      page,
      citiesCount: citiesTotal,
      warehousesCount: warehousesTotal,
    });
  }

  return {
    status: "progress",
    phase,
    page,
    message:
      phase === "cities"
        ? `Завантажуємо міста: сторінка ${page}…`
        : `Завантажуємо відділення: сторінка ${page}…`,
  };
}

/** «Оновити зараз» для власника: один виклик, який продовжує або починає прогін без очікування доби. */
export async function syncDirectoriesNow(
  db: AnyPgDatabase,
  actor: AppUser,
  options: Omit<Options, "force"> = {},
): Promise<SyncResult> {
  requirePermission(actor, "migration_settings", "write");
  return runDirectorySync(db, { ...options, force: true });
}
