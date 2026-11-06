import { z } from "zod";

/**
 * Змінні середовища.
 *
 * Перевірка ледача (під час першого звернення), а не під час збірки, щоб `next build`
 * у CI не вимагав реальних ключів. У повідомленнях про помилки лише імена змінних,
 * значення (рядки підключення, ключі) ніколи не потрапляють у текст помилки.
 */
const schema = z.object({
  APP_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
  DATABASE_URL: z.url(),
  // B2: Supabase Auth і Realtime. До B2 необов'язкові.
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Некоректні або відсутні змінні середовища: ${variables.join(", ")}`);
    this.name = "EnvError";
    this.variables = variables;
  }
}

/** Розбирає і перевіряє змінні. Порожній рядок (як у .env.example) вважається відсутнім значенням. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
    throw new EnvError(names);
  }
  return result.data;
}

const keys = Object.keys(schema.shape);

let cache: { fingerprint: string; env: Env } | undefined;

/**
 * Повертає перевірені змінні. Результат кешується, але кеш прив'язаний до значень змінних:
 * якщо вони змінилися (у dev після правки .env.local Next.js оновлює process.env),
 * вони перевіряються знову, тож перезапуск сервера не потрібен.
 */
export function getEnv(): Env {
  const fingerprint = JSON.stringify(keys.map((key) => process.env[key]));
  if (cache?.fingerprint !== fingerprint) {
    cache = { fingerprint, env: parseEnv(process.env) };
  }
  return cache.env;
}
