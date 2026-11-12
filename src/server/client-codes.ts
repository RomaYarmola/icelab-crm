import { sql } from "drizzle-orm";
import { rowsOf } from "@/db/rows";
import type { AnyPgDatabase } from "@/db/types";
import {
  formatClientCode,
  isRegionPrefix,
  isValidClientCode,
  PLACEHOLDER_CLIENT_CODE,
} from "@/utils/clientCode";

/**
 * Видача коду новому клієнтові (D42). Номер дорівнює найбільшому в цьому префіксі плюс 1 серед
 * усіх клієнтів, зокрема видалених (код лишається зайнятим, D16), а клієнта-заглушку з кодом 404
 * не враховуємо. Без області (`null`) код складається з самих цифр: найбільший цифровий плюс 1,
 * причому 404 пропускаємо, бо він зарезервований за заглушкою.
 */

type Executor = AnyPgDatabase;

/** Назва обмеження унікальності коду (див. схему `clients`). */
export const CLIENT_CODE_UNIQUE_CONSTRAINT = "clients_code_uq";

const UNIQUE_VIOLATION = "23505";

/**
 * Рахує наступний код за наявними клієнтами, нічого не блокуючи. Для підказки «буде АА16» у формі;
 * справжній код видає `nextClientCode`, бо між підказкою й збереженням хтось міг створити клієнта.
 */
export async function peekNextClientCode(
  db: Executor,
  regionPrefix: string | null,
): Promise<string> {
  if (regionPrefix !== null && !isRegionPrefix(regionPrefix)) {
    throw new Error(`Некоректний префікс області: ${regionPrefix}`);
  }

  const result =
    regionPrefix === null
      ? await db.execute(sql`
          select coalesce(max(case when code ~ '^[0-9]+$' then code::bigint end), 0) as max_number
          from clients
          where not is_placeholder`)
      : await db.execute(sql`
          select coalesce(
            max(case when substr(code, ${regionPrefix.length + 1}::int) ~ '^[0-9]+$'
                     then substr(code, ${regionPrefix.length + 1}::int)::bigint end),
            0) as max_number
          from clients
          where code like ${`${regionPrefix}%`} and not is_placeholder`);

  const row = rowsOf<{ max_number: string | number }>(result)[0];
  let next = Number(row?.max_number ?? 0) + 1;
  if (regionPrefix === null && String(next) === PLACEHOLDER_CLIENT_CODE) next += 1;

  const code = formatClientCode(regionPrefix, next);
  if (!isValidClientCode(code)) throw new Error(`Не вдалося видати код клієнта: ${code}`);
  return code;
}

/**
 * Видає наступний код. Викликати всередині транзакції, у якій одразу створюється клієнт (`withActor`):
 * блокування префікса діє до кінця транзакції, тож двоє менеджерів не отримають однаковий номер.
 */
export async function nextClientCode(tx: Executor, regionPrefix: string | null): Promise<string> {
  if (regionPrefix !== null && !isRegionPrefix(regionPrefix)) {
    throw new Error(`Некоректний префікс області: ${regionPrefix}`);
  }

  // Окреме блокування на кожен префікс і на цифрові коди.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`client-code:${regionPrefix ?? "#"}`}))`,
  );
  return peekNextClientCode(tx, regionPrefix);
}

/** Чи помилка це збіг коду клієнта з уже наявним (двоє створили клієнтів одночасно). */
export function isCodeConflict(error: unknown): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    constraint_name?: string;
    message?: string;
    cause?: { code?: string; constraint?: string; constraint_name?: string; message?: string };
  };
  const source = e.cause ?? e;
  if ((source.code ?? e.code) !== UNIQUE_VIOLATION) return false;
  const constraint =
    source.constraint ?? source.constraint_name ?? e.constraint ?? e.constraint_name;
  if (constraint) return constraint === CLIENT_CODE_UNIQUE_CONSTRAINT;
  return `${source.message ?? ""} ${e.message ?? ""}`.includes(CLIENT_CODE_UNIQUE_CONSTRAINT);
}

/**
 * Повторює створення клієнта, якщо код встиг зайняти хтось інший. Блокування префікса зазвичай
 * цього не допускає, повтор лишається запасним захистом (наприклад, при ручному імпорті).
 */
export async function retryOnCodeConflict<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isCodeConflict(error)) throw error;
    }
  }
}
