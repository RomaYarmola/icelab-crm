import { sql } from "drizzle-orm";
import type { AnyPgDatabase } from "./types";

type Tx<TDb extends AnyPgDatabase> = Parameters<Parameters<TDb["transaction"]>[0]>[0];

export type ActorOptions = {
  /** Примітка до зміни (наприклад, причина зворотного переходу статусу). */
  note?: string;
};

/**
 * Виконує `fn` в одній транзакції, у якій база знає, хто змінює дані.
 *
 * Тригери читають параметри `app.actor_id` і `app.change_note` для полів `created_by`,
 * `order_status_history.changed_by` і `audit_log.actor_id`. Параметри діють лише в межах
 * цієї транзакції. `actorId = null` означає системну зміну.
 *
 * Правило проєкту: усі записи в базу з серверного коду роблять через `withActor`.
 */
export async function withActor<TDb extends AnyPgDatabase, T>(
  db: TDb,
  actorId: string | null,
  fn: (tx: Tx<TDb>) => Promise<T>,
  options: ActorOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.actor_id', ${actorId ?? ""}, true), set_config('app.change_note', ${options.note ?? ""}, true)`,
    );
    return fn(tx as Tx<TDb>);
  });
}
