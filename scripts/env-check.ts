import "./_load-env";
import { EnvError, parseEnv, parseSupabaseAdminEnv } from "@/env";

// Перевіряє змінні середовища з .env.local і показує для кожної лише «задано чи ні» та вид ключа.
// Значень не виводить, тож результат можна безпечно показувати.
//
//   npm run env:check

const NAMES = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

/** Імена змінних, які не пройшли перевірку (відсутні, порожні або мають неправильний вигляд). */
function invalidNames(): Set<string> {
  const invalid = new Set<string>();
  for (const parse of [parseEnv, parseSupabaseAdminEnv]) {
    try {
      parse(process.env);
    } catch (error) {
      if (!(error instanceof EnvError)) throw error;
      for (const name of error.variables) invalid.add(name);
    }
  }
  return invalid;
}

/** Вид ключа за його початком: без показу самого ключа. */
function keyKind(value: string): string {
  if (value.startsWith("sb_publishable_")) return "publishable key нового формату";
  if (value.startsWith("sb_secret_")) return "secret key нового формату";
  if (value.startsWith("eyJ")) return "ключ старого формату (JWT)";
  return "невідомий формат";
}

const invalid = invalidNames();
let failed = false;

for (const name of NAMES) {
  const value = process.env[name];
  if (!value) {
    console.log(`✗ ${name}: не задано (порожнє значення або змінної немає в .env.local)`);
    failed = true;
  } else if (invalid.has(name)) {
    const hint = name.includes("KEY")
      ? ` (вид: ${keyKind(value)}; перевірте, чи не переплутано ключі)`
      : "";
    console.log(`✗ ${name}: задано, але значення неправильне${hint}`);
    failed = true;
  } else {
    const kind = name.includes("KEY") ? `, вид: ${keyKind(value)}` : "";
    console.log(`✓ ${name}: задано${kind}`);
  }
}

console.log(failed ? "\nЄ проблеми: виправте .env.local і запустіть ще раз." : "\nУсе гаразд.");
if (failed) process.exitCode = 1;
