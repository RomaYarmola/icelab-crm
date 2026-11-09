import { sql } from "drizzle-orm";
import type { AnyPgDatabase } from "./types";

/**
 * Видаляє всі таблиці, типи й функції проєкту зі схеми `public` та журнал міграцій Drizzle.
 * Об'єкти розширень (наприклад, pg_trgm) не чіпає.
 *
 * ТІЛЬКИ ДЛЯ ТЕСТОВИХ БАЗ. Захист від запуску не на dev лежить у `scripts/db-reset.ts`.
 */
export async function resetDatabase(db: AnyPgDatabase): Promise<void> {
  await db.execute(sql`
    do $$
    declare r record;
    begin
      for r in
        select c.oid::regclass as obj
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      loop
        execute format('drop table if exists %s cascade', r.obj);
      end loop;

      for r in
        select t.oid::regtype as obj
          from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public' and t.typtype = 'e'
           and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
      loop
        execute format('drop type if exists %s cascade', r.obj);
      end loop;

      for r in
        select p.oid::regprocedure as obj
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      loop
        execute format('drop function if exists %s cascade', r.obj);
      end loop;
    end
    $$
  `);
  await db.execute(sql`drop schema if exists drizzle cascade`);
}
