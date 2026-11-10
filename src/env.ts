import { z } from "zod";

/**
 * Змінні середовища.
 *
 * Перевірка ледача (під час першого звернення), а не під час збірки, щоб `next build`
 * у CI не вимагав реальних ключів. У повідомленнях про помилки лише імена змінних,
 * значення (рядки підключення, ключі) ніколи не потрапляють у текст помилки.
 *
 * Змінні Supabase у загальній схемі необов'язкові: скрипти бази (`db:seed`, `db:smoke`)
 * працюють без них. Код входу викликає `getSupabaseEnv()` або `getSupabaseAdminEnv()`,
 * які вимагають потрібні змінні.
 */
/** Роль зі старого ключа Supabase у форматі JWT (`anon` або `service_role`), якщо це він. */
function legacyKeyRole(value: string): string | undefined {
  const payload = value.split(".")[1];
  if (!payload) return undefined;
  try {
    const role: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Публічний ключ потрапляє в браузер (змінна з префіксом NEXT_PUBLIC_). Якщо в неї помилково
 * вставити секретний ключ, він стане доступним кожному відвідувачу, тому такий ключ відхиляємо.
 */
const publishableKey = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("sb_secret_") && legacyKeyRole(value) !== "service_role");

/** Секретний ключ не може бути публічним: їх легко переплутати при копіюванні. */
const secretKey = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("sb_publishable_") && legacyKeyRole(value) !== "anon");

const schema = z.object({
  APP_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
  DATABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey.optional(),
  SUPABASE_SECRET_KEY: secretKey.optional(),
});

/** Для входу користувачів: адреса проєкту і публічний (publishable) ключ. */
const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
});

/** Для керування користувачами (лише сервер): додатково секретний ключ. */
const supabaseAdminSchema = supabaseSchema.extend({
  SUPABASE_SECRET_KEY: secretKey,
});

export type Env = z.infer<typeof schema>;
export type SupabaseEnv = z.infer<typeof supabaseSchema>;
export type SupabaseAdminEnv = z.infer<typeof supabaseAdminSchema>;

export class EnvError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Некоректні або відсутні змінні середовища: ${variables.join(", ")}`);
    this.name = "EnvError";
    this.variables = variables;
  }
}

type RawEnv = Record<string, string | undefined>;

/** Розбирає і перевіряє змінні. Порожній рядок (як у .env.example) вважається відсутнім значенням. */
function parseWith<S extends z.ZodType>(target: S, raw: RawEnv): z.output<S> {
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = target.safeParse(cleaned);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
    throw new EnvError(names);
  }
  return result.data;
}

export const parseEnv = (raw: RawEnv): Env => parseWith(schema, raw);
export const parseSupabaseEnv = (raw: RawEnv): SupabaseEnv => parseWith(supabaseSchema, raw);
export const parseSupabaseAdminEnv = (raw: RawEnv): SupabaseAdminEnv =>
  parseWith(supabaseAdminSchema, raw);

/**
 * Повертає перевірені змінні. Результат кешується, але кеш прив'язаний до значень змінних:
 * якщо вони змінилися (у dev після правки .env.local Next.js оновлює process.env),
 * вони перевіряються знову, тож перезапуск сервера не потрібен.
 */
function cachedGetter<T>(keys: string[], parse: (raw: RawEnv) => T): () => T {
  let cache: { fingerprint: string; value: T } | undefined;
  return () => {
    const fingerprint = JSON.stringify(keys.map((key) => process.env[key]));
    if (cache?.fingerprint !== fingerprint) {
      cache = { fingerprint, value: parse(process.env) };
    }
    return cache.value;
  };
}

export const getEnv = cachedGetter(Object.keys(schema.shape), parseEnv);
export const getSupabaseEnv = cachedGetter(Object.keys(supabaseSchema.shape), parseSupabaseEnv);
export const getSupabaseAdminEnv = cachedGetter(
  Object.keys(supabaseAdminSchema.shape),
  parseSupabaseAdminEnv,
);
