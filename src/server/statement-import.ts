import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { bankAccounts, payments, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { kopecksToUah, toKopecks } from "./cash-rules";
import { type AppUser, requirePermission } from "./guards";
import { matchNewPayments } from "./payments";
import {
  applyMapping,
  type ColumnMapping,
  guessMapping,
  type ImportRow,
  mappingFits,
  readStatementFile,
  type StatementTable,
} from "./statement-file";

/**
 * Імпорт файла виписки (B13, ТЗ 6.10): запасний шлях, коли API банку недоступний чи треба догнати
 * період. Попередній перегляд нічого не пише. Дублі відсікаємо за відбитком (дата, сума, опис) і за
 * схожістю на платіж, що вже прийшов з API (та сама сума в межах хвилини). Повторне завантаження
 * того самого файла нічого не додає. Лише власник і бухгалтер.
 */

export const MAPPING_KEY = "payment.import_mapping";
const NEAR_MS = 60_000;

export type ImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  /** Зіставлення взято із збереженого шаблону. */
  fromTemplate: boolean;
  total: number;
  skippedOutgoing: number;
  errors: { line: number; message: string }[];
  duplicates: number;
  fresh: number;
  sample: {
    line: number;
    occurredAt: string;
    amount: string;
    counterName: string | null;
    description: string | null;
  }[];
};

async function loadTemplate(db: AnyPgDatabase): Promise<ColumnMapping | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, MAPPING_KEY));
  const value = row?.value as Partial<ColumnMapping> | undefined;
  if (!value || typeof value !== "object") return null;
  return {
    date: value.date ?? null,
    amount: value.amount ?? null,
    description: value.description ?? null,
    counter: value.counter ?? null,
    comment: value.comment ?? null,
  };
}

/** Які рядки вже є в базі: за відбитком чи як схожий платіж (та сама сума, час у межах хвилини). */
async function findDuplicates(db: AnyPgDatabase, rows: ImportRow[]): Promise<Set<string>> {
  const duplicates = new Set<string>();
  if (rows.length === 0) return duplicates;
  const hashes = rows.map((row) => row.hash);
  for (let i = 0; i < hashes.length; i += 500) {
    const found = await db
      .select({ hash: payments.dedupeHash })
      .from(payments)
      .where(inArray(payments.dedupeHash, hashes.slice(i, i + 500)));
    for (const item of found) if (item.hash) duplicates.add(item.hash);
  }
  const times = rows.map((row) => row.occurredAt.getTime());
  const existing = await db
    .select({ occurredAt: payments.occurredAt, amount: payments.amount })
    .from(payments)
    .where(
      and(
        gte(payments.occurredAt, new Date(Math.min(...times) - NEAR_MS)),
        lte(payments.occurredAt, new Date(Math.max(...times) + NEAR_MS)),
      ),
    );
  const byAmount = new Map<number, number[]>();
  for (const item of existing) {
    const key = toKopecks(item.amount);
    byAmount.set(key, [...(byAmount.get(key) ?? []), item.occurredAt.getTime()]);
  }
  for (const row of rows) {
    const near = byAmount.get(row.amountKopecks) ?? [];
    if (near.some((time) => Math.abs(time - row.occurredAt.getTime()) <= NEAR_MS)) {
      duplicates.add(row.hash);
    }
  }
  return duplicates;
}

function resolve(
  table: StatementTable,
  template: ColumnMapping | null,
  requested: ColumnMapping | null,
) {
  if (requested) return { mapping: requested, fromTemplate: false };
  if (template && mappingFits(template, table.headers))
    return { mapping: template, fromTemplate: true };
  return { mapping: guessMapping(table.headers), fromTemplate: false };
}

/** Попередній перегляд: що в файлі, які колонки, скільки нових платежів і дублів. Нічого не записує. */
export async function previewStatementImport(
  db: AnyPgDatabase,
  actor: AppUser,
  file: { name: string; bytes: Uint8Array },
  requested: ColumnMapping | null = null,
): Promise<ImportPreview> {
  requirePermission(actor, "bank_payments", "write");
  const table = readStatementFile(file.name, file.bytes);
  const { mapping, fromTemplate } = resolve(table, await loadTemplate(db), requested);
  const base = { headers: table.headers, mapping, fromTemplate };
  if (!mapping.date || !mapping.amount) {
    return {
      ...base,
      total: table.rows.length,
      skippedOutgoing: 0,
      errors: [],
      duplicates: 0,
      fresh: 0,
      sample: [],
    };
  }
  const parsed = applyMapping(table, mapping);
  const duplicates = await findDuplicates(db, parsed.rows);
  const fresh = parsed.rows.filter((row) => !duplicates.has(row.hash));
  return {
    ...base,
    total: table.rows.length,
    skippedOutgoing: parsed.skippedOutgoing,
    errors: parsed.errors.slice(0, 20),
    duplicates: parsed.rows.length - fresh.length,
    fresh: fresh.length,
    sample: fresh.slice(0, 8).map((row) => ({
      line: row.line,
      occurredAt: row.occurredAt.toISOString(),
      amount: kopecksToUah(row.amountKopecks),
      counterName: row.counterName,
      description: row.description,
    })),
  };
}

export type ImportResult = {
  inserted: number;
  duplicates: number;
  matched: number;
  errors: number;
};

/**
 * Імпорт: записує нові платежі (джерело «файл»), зберігає зіставлення колонок як шаблон і одразу
 * запускає автозіставлення. Файл читаємо на сервері знову: рядкам із браузера не довіряємо. Якщо в
 * файлі є помилкові рядки, їх пропускаємо й повідомляємо кількість.
 */
export async function commitStatementImport(
  db: AnyPgDatabase,
  actor: AppUser,
  file: { name: string; bytes: Uint8Array },
  mapping: ColumnMapping,
): Promise<ImportResult> {
  requirePermission(actor, "bank_payments", "write");
  const table = readStatementFile(file.name, file.bytes);
  const parsed = applyMapping(table, mapping);
  const duplicates = await findDuplicates(db, parsed.rows);
  const fresh = parsed.rows.filter((row) => !duplicates.has(row.hash));
  const [account] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(eq(bankAccounts.provider, "monobank"))
    .limit(1);

  let inserted = 0;
  await withActor(
    db,
    actor.id,
    async (tx) => {
      for (const row of fresh) {
        const created = await tx
          .insert(payments)
          .values({
            bankAccountId: account?.id ?? null,
            dedupeHash: row.hash,
            occurredAt: row.occurredAt,
            amount: kopecksToUah(row.amountKopecks),
            currency: "UAH",
            description: row.description,
            counterName: row.counterName,
            comment: row.comment,
            importedVia: "file",
          })
          .onConflictDoNothing()
          .returning({ id: payments.id });
        inserted += created.length;
      }
      const [existing] = await tx
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, MAPPING_KEY));
      if (existing)
        await tx.update(settings).set({ value: mapping }).where(eq(settings.key, MAPPING_KEY));
      else await tx.insert(settings).values({ key: MAPPING_KEY, value: mapping });
    },
    { note: `Імпорт файла виписки: ${file.name}` },
  );
  const matched = inserted > 0 ? (await matchNewPayments(db)).matched : 0;
  return {
    inserted,
    duplicates: parsed.rows.length - inserted,
    matched,
    errors: parsed.errors.length,
  };
}
