import { sql } from "drizzle-orm";
import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** Первинний ключ uuid, який генерує база. */
export const pk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** `created_at` і `updated_at` (час останньої зміни виставляє тригер у базі). */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Гроші: `numeric(10,2)`. Драйвер віддає рядок, щоб не втрачати точність. */
export const money = (name: string) => numeric(name, { precision: 10, scale: 2 });

/** Кілограми: `numeric(10,3)`. */
export const kg = (name: string) => numeric(name, { precision: 10, scale: 3 });

/** Відсотки: `numeric(5,2)`. */
export const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

/** Видалення запису довідника заборонено, поки на нього є посилання. */
export const restrict = { onDelete: "restrict" } as const;
