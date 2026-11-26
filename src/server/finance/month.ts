import { and, asc, eq, gte, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/db/actor";
import {
  clients,
  commissionRates,
  financeMonths,
  fxRates,
  ledgerCategories,
  ledgerEntries,
  locations,
  orderItems,
  orders,
  profiles,
} from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { kopecksToUah, toKopecks } from "@/server/cash-rules";
import { parseInput, ValidationError } from "@/server/errors";
import { type AppUser, requirePermission } from "@/server/guards";
import { addDays, todayIso } from "@/utils/isoDate";
import { shiftMonth } from "@/utils/month";
import { parseDecimal } from "@/utils/orderMath";
import { loadCo2Ledger } from "./co2";
import { buildReport, type ColumnInput, type MonthReport } from "./month-rules";

/**
 * Місяць фінрезультату (B15, фаза Б3): статті витрат і доходів, комісійні менеджерів, курс долара,
 * підсумки й закриття місяця. Бачить і змінює лише власник.
 */

const uuid = z.uuid("Некоректний ідентифікатор.");
const MAX_AMOUNT = 99_000_000;
const COMMON_NAME = "Спільні";

const monthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Оберіть місяць.");

const parseAmount = (value: string | number, message: string) => {
  const number = typeof value === "number" ? value : parseDecimal(value);
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(message);
  if (number > MAX_AMOUNT) throw new ValidationError("Надто велика сума: перевірте число.");
  return number;
};

const firstDay = (month: string) => `${month}-01`;

function lastDay(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const next =
    number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/** Не дає змінювати місяць і закривати його одночасно та відхиляє зміни в закритому. */
async function assertOpen(tx: AnyPgDatabase, month: string) {
  await lockMonth(tx, month);
  const [closed] = await tx
    .select({ id: financeMonths.id })
    .from(financeMonths)
    .where(eq(financeMonths.month, firstDay(month)));
  if (closed) throw new ValidationError("Місяць закрито: спершу відкрийте його.");
}

async function lockMonth(tx: AnyPgDatabase, month: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`finance_month:${month}`}))`);
}

const monthOrders = (month: string) =>
  and(
    isNull(orders.deletedAt),
    notInArray(orders.status, ["draft", "cancelled"]),
    gte(orders.orderDate, firstDay(month)),
    lte(orders.orderDate, lastDay(month)),
  );

const activeLocations = (db: AnyPgDatabase) =>
  db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));

/** Ставка кожної людини, що діє в місяці (остання з тих, що почались не пізніше). */
async function ratesFor(db: AnyPgDatabase, month: string) {
  const rows = await db
    .select()
    .from(commissionRates)
    .where(lte(commissionRates.validFrom, firstDay(month)))
    .orderBy(asc(commissionRates.validFrom));
  return new Map(rows.map((row) => [row.profileId, toKopecks(row.ratePerKg)]));
}

/** Рахує місяць із поточних даних бази. Без перевірки прав. */
async function computeReport(
  db: AnyPgDatabase,
  month: string,
  today: string,
): Promise<MonthReport> {
  const cities = await activeLocations(db);
  const where = monthOrders(month);
  const [revenueRows, kgRows, entryRows, rateRow, rates] = await Promise.all([
    db
      .select({
        locationId: orders.locationId,
        kind: orderItems.kind,
        amount: sql<string>`sum(${orderItems.amount})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(where)
      .groupBy(orders.locationId, orderItems.kind),
    db
      .select({
        locationId: orders.locationId,
        profileId: profiles.id,
        name: profiles.fullName,
        kg: sql<string>`sum(${orders.kgSold})`,
      })
      .from(orders)
      .innerJoin(clients, eq(clients.id, orders.clientId))
      .innerJoin(profiles, eq(profiles.id, clients.managerId))
      .where(where)
      .groupBy(orders.locationId, profiles.id, profiles.fullName)
      .orderBy(asc(profiles.fullName)),
    db
      .select({
        locationId: ledgerEntries.locationId,
        amount: ledgerEntries.amount,
        label: ledgerCategories.name,
        kind: ledgerCategories.kind,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerCategories, eq(ledgerCategories.id, ledgerEntries.categoryId))
      .where(eq(ledgerEntries.month, firstDay(month)))
      .orderBy(asc(ledgerCategories.sort), asc(ledgerCategories.name)),
    db
      .select()
      .from(fxRates)
      .where(eq(fxRates.month, firstDay(month))),
    ratesFor(db, month),
  ]);

  const end = lastDay(month) < today ? lastDay(month) : today;
  const lines = (locationId: string | null, kind: string) =>
    entryRows
      .filter((row) => row.locationId === locationId && row.kind === kind)
      .map((row) => ({ label: row.label, kopecks: toKopecks(row.amount) }));
  const revenueOf = (locationId: string, kind: string) =>
    toKopecks(
      revenueRows.find((row) => row.locationId === locationId && row.kind === kind)?.amount ?? 0,
    );

  const columns: ColumnInput[] = [];
  for (const city of cities) {
    const ledger = await loadCo2Ledger(db, city.id, end);
    const co2 = ledger.months.find((item) => item.month === month);
    columns.push({
      locationId: city.id,
      name: city.name,
      revenue: {
        ice: revenueOf(city.id, "ice"),
        delivery: revenueOf(city.id, "delivery"),
        boxes: revenueOf(city.id, "box_sale"),
        other: revenueOf(city.id, "other"),
      },
      otherIncome: lines(city.id, "income"),
      co2: {
        orders: co2?.orders.costKopecks ?? 0,
        writeoffs: co2?.writeoffs.costKopecks ?? 0,
        shortageGrams: co2?.shortageGrams ?? 0,
      },
      expenses: lines(city.id, "expense"),
      commissions: kgRows
        .filter((row) => row.locationId === city.id)
        // Людей без ставки показуємо лише коли вони менеджери з кілограмами: щоб ставку не забули.
        .map((row) => ({
          profileId: row.profileId,
          name: row.name,
          grams: Math.round(Number(row.kg) * 1000),
          rateKopecks: rates.get(row.profileId) ?? null,
        }))
        .filter((row) => row.grams > 0),
    });
  }
  columns.push({
    locationId: null,
    name: COMMON_NAME,
    revenue: { ice: 0, delivery: 0, boxes: 0, other: 0 },
    otherIncome: lines(null, "income"),
    co2: { orders: 0, writeoffs: 0, shortageGrams: 0 },
    expenses: lines(null, "expense"),
    commissions: [],
  });
  return buildReport({
    month,
    columns,
    usdRate: rateRow[0] ? Number(rateRow[0].usdRate) : null,
  });
}

export type MonthReportData = {
  month: string;
  currentMonth: string;
  closedAt: string | null;
  /** Для закритого місяця зафіксовані цифри, інакше пораховані зараз. */
  report: MonthReport;
};

/** Звіт за місяць (Б4). Майбутній чи некоректний місяць замінюється поточним. */
export async function getMonthReport(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { month?: string; today?: string } = {},
): Promise<MonthReportData> {
  requirePermission(actor, "finance", "read");
  const today = query.today ?? todayIso();
  const currentMonth = today.slice(0, 7);
  const parsed = monthField.safeParse(query.month);
  const month = parsed.success && parsed.data <= currentMonth ? parsed.data : currentMonth;
  const [closed] = await db
    .select()
    .from(financeMonths)
    .where(eq(financeMonths.month, firstDay(month)));
  return {
    month,
    currentMonth,
    closedAt: closed?.closedAt.toISOString() ?? null,
    report: closed ? (closed.snapshot as MonthReport) : await computeReport(db, month, today),
  };
}

export type EntryField = {
  categoryId: string;
  name: string;
  kind: "expense" | "income";
  /** Збережена сума, грн; порожньо, якщо не внесено. */
  amount: string | null;
  /** Сума минулого місяця для «однакової щомісяця», ще не збережена. */
  suggestion: string | null;
};

export type EntryScope = { locationId: string | null; name: string; fields: EntryField[] };

export type MonthPageData = MonthReportData & {
  scopes: EntryScope[];
  managers: { profileId: string; name: string; rate: string | null }[];
  categories: {
    id: string;
    name: string;
    kind: "expense" | "income";
    repeatsMonthly: boolean;
    isActive: boolean;
  }[];
};

async function loadScopes(db: AnyPgDatabase, month: string): Promise<EntryScope[]> {
  const [cities, categories, entries] = await Promise.all([
    activeLocations(db),
    db
      .select()
      .from(ledgerCategories)
      .orderBy(asc(ledgerCategories.sort), asc(ledgerCategories.name)),
    db
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.month, [firstDay(month), firstDay(shiftMonth(month, -1))])),
  ]);
  const scopes = [...cities, { id: null, name: COMMON_NAME }];
  return scopes.map((scope) => ({
    locationId: scope.id,
    name: scope.name,
    fields: categories.flatMap((category) => {
      const find = (day: string) =>
        entries.find(
          (e) => e.month === day && e.categoryId === category.id && e.locationId === scope.id,
        );
      const saved = find(firstDay(month));
      // Вимкнену статтю показуємо, лише якщо в цьому місяці в неї вже є сума.
      if (!category.isActive && !saved) return [];
      const previous =
        !saved && category.repeatsMonthly ? find(firstDay(shiftMonth(month, -1))) : undefined;
      return [
        {
          categoryId: category.id,
          name: category.name,
          kind: category.kind as "expense" | "income",
          amount: saved?.amount ?? null,
          suggestion: previous?.amount ?? null,
        },
      ];
    }),
  }));
}

export async function getMonthPage(
  db: AnyPgDatabase,
  actor: AppUser,
  query: { month?: string; today?: string } = {},
): Promise<MonthPageData> {
  const base = await getMonthReport(db, actor, query);
  const { month } = base;

  const [scopes, categories, people, rates] = await Promise.all([
    loadScopes(db, month),
    db
      .select()
      .from(ledgerCategories)
      .orderBy(asc(ledgerCategories.sort), asc(ledgerCategories.name)),
    db
      .select({ id: profiles.id, name: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.isActive, true), inArray(profiles.role, ["manager", "owner"])))
      .orderBy(asc(profiles.fullName)),
    ratesFor(db, month),
  ]);

  return {
    ...base,
    scopes,
    managers: people.map((person) => {
      const rate = rates.get(person.id);
      return {
        profileId: person.id,
        name: person.name,
        rate: rate === undefined ? null : kopecksToUah(rate),
      };
    }),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as "expense" | "income",
      repeatsMonthly: c.repeatsMonthly,
      isActive: c.isActive,
    })),
  };
}

const entriesSchema = z.object({
  month: monthField,
  locationId: uuid.nullable(),
  amounts: z.array(z.object({ categoryId: uuid, amount: z.string() })).max(200),
});

/** Зберігає суми статей одного міста (чи спільні) за місяць; порожнє поле прибирає суму. */
export async function saveLedgerEntries(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof entriesSchema>,
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const data = parseInput(entriesSchema, input);
  const values = data.amounts.map((row) => ({
    categoryId: row.categoryId,
    amount:
      row.amount.trim() === ""
        ? null
        : parseAmount(row.amount, "Суми мають бути числами від нуля.").toFixed(2),
  }));
  await withActor(db, actor.id, async (tx) => {
    await assertOpen(tx, data.month);
    for (const row of values) {
      const where = and(
        eq(ledgerEntries.month, firstDay(data.month)),
        eq(ledgerEntries.categoryId, row.categoryId),
        data.locationId === null
          ? isNull(ledgerEntries.locationId)
          : eq(ledgerEntries.locationId, data.locationId),
      );
      const [current] = await tx.select().from(ledgerEntries).where(where);
      if (row.amount === null) {
        if (current) await tx.delete(ledgerEntries).where(where);
      } else if (!current) {
        await tx.insert(ledgerEntries).values({
          month: firstDay(data.month),
          locationId: data.locationId,
          categoryId: row.categoryId,
          amount: row.amount,
        });
      } else if (Number(current.amount) !== Number(row.amount)) {
        await tx.update(ledgerEntries).set({ amount: row.amount }).where(where);
      }
    }
  });
}

const categorySchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву статті.").max(80, "Назва надто довга."),
  kind: z.enum(["expense", "income"], "Оберіть: витрата чи дохід."),
  repeatsMonthly: z.boolean(),
});

async function assertNewName(db: AnyPgDatabase, name: string, exceptId?: string) {
  const rows = await db.select().from(ledgerCategories);
  const taken = rows.some(
    (row) =>
      row.id !== exceptId && row.name.toLocaleLowerCase("uk") === name.toLocaleLowerCase("uk"),
  );
  if (taken) throw new ValidationError("Стаття з такою назвою вже є.");
}

export async function addCategory(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof categorySchema>,
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const data = parseInput(categorySchema, input);
  await assertNewName(db, data.name);
  await withActor(db, actor.id, async (tx) => {
    await tx.insert(ledgerCategories).values(data);
  });
}

const categoryPatchSchema = z.object({
  id: uuid,
  repeatsMonthly: z.boolean(),
  isActive: z.boolean(),
});

/** Позначки статті: «однакова щомісяця» й активність. Назву й вид не міняємо, щоб не плутати історію. */
export async function updateCategory(
  db: AnyPgDatabase,
  actor: AppUser,
  input: z.input<typeof categoryPatchSchema>,
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const { id, ...patch } = parseInput(categoryPatchSchema, input);
  await withActor(db, actor.id, async (tx) => {
    const updated = await tx
      .update(ledgerCategories)
      .set(patch)
      .where(eq(ledgerCategories.id, id))
      .returning({ id: ledgerCategories.id });
    if (updated.length === 0) throw new ValidationError("Статтю не знайдено.");
  });
}

/** Ставка комісійних людини з вибраного місяця; повторний запис на той самий місяць замінює її. */
export async function setCommissionRate(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { profileId: string; month: string; ratePerKg: string | number },
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const profileId = parseInput(uuid, input.profileId);
  const month = parseInput(monthField, input.month);
  if (String(input.ratePerKg).trim() === "") throw new ValidationError("Вкажіть ставку за кг.");
  const ratePerKg = parseAmount(input.ratePerKg, "Ставка має бути числом від нуля.").toFixed(2);
  await withActor(db, actor.id, async (tx) => {
    await assertOpen(tx, month);
    await tx
      .insert(commissionRates)
      .values({ profileId, validFrom: firstDay(month), ratePerKg })
      .onConflictDoUpdate({
        target: [commissionRates.profileId, commissionRates.validFrom],
        set: { ratePerKg },
      });
  });
}

export async function setUsdRate(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { month: string; usdRate: string | number },
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const month = parseInput(monthField, input.month);
  const value = parseAmount(input.usdRate, "Вкажіть курс долара, більше нуля.");
  if (!(value > 0)) throw new ValidationError("Вкажіть курс долара, більше нуля.");
  const usdRate = value.toFixed(4);
  await withActor(db, actor.id, async (tx) => {
    await assertOpen(tx, month);
    await tx
      .insert(fxRates)
      .values({ month: firstDay(month), usdRate })
      .onConflictDoUpdate({ target: fxRates.month, set: { usdRate } });
  });
}

/**
 * Закриває місяць (D234): фіксує пораховані цифри. Лише завершений місяць, із курсом долара й
 * без непідтверджених сум «однаково щомісяця».
 */
export async function closeMonth(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { month: string },
  today: string = todayIso(),
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const month = parseInput(monthField, input.month);
  if (month >= today.slice(0, 7)) {
    throw new ValidationError("Місяць ще не завершився: закрити його можна з наступного.");
  }
  await withActor(db, actor.id, async (tx) => {
    await assertOpen(tx, month);
    const scopes = await loadScopes(tx, month);
    const pending = scopes.flatMap((scope) =>
      scope.fields
        .filter((field) => field.suggestion !== null)
        .map((field) => `${field.name} (${scope.name})`),
    );
    if (pending.length > 0) {
      throw new ValidationError(
        `Збережіть або очистіть суми з минулого місяця: ${pending.join(", ")}.`,
      );
    }
    const report = await computeReport(tx, month, today);
    if (report.usdRate === null) throw new ValidationError("Спершу внесіть курс долара.");
    await tx.insert(financeMonths).values({ month: firstDay(month), snapshot: report });
  });
}

/** Відкриває закритий місяць, щоб виправити помилку: зафіксовані цифри лишаються в журналі змін. */
export async function reopenMonth(
  db: AnyPgDatabase,
  actor: AppUser,
  input: { month: string },
): Promise<void> {
  requirePermission(actor, "finance", "write");
  const month = parseInput(monthField, input.month);
  await withActor(db, actor.id, async (tx) => {
    await lockMonth(tx, month);
    const deleted = await tx
      .delete(financeMonths)
      .where(eq(financeMonths.month, firstDay(month)))
      .returning({ id: financeMonths.id });
    if (deleted.length === 0) throw new ValidationError("Місяць не закрито.");
  });
}
