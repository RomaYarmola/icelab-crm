import "./_load-env";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Перевіряє, що серверні секрети не потрапили у файли для браузера (`.next/static`).
// Запускати після `npm run build`.
//
// Шукає, по-перше, назви серверних змінних (їх можна згадати лише в серверному коді) і,
// по-друге, самі значення секретів, якщо вони задані в середовищі (локально з .env.local).
// У CI значень немає, тож там спрацьовує лише перевірка назв.

const DIRECTORY = ".next/static";
const SERVER_ONLY_NAMES = ["SUPABASE_SECRET_KEY", "DATABASE_URL"];
const SECRET_VARIABLES = ["SUPABASE_SECRET_KEY", "DATABASE_URL"];

function* files(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

function main() {
  try {
    statSync(DIRECTORY);
  } catch {
    throw new Error(`Немає папки ${DIRECTORY}: спершу виконайте npm run build.`);
  }

  const secretValues = SECRET_VARIABLES.map((name) => ({ name, value: process.env[name] })).filter(
    (item): item is { name: string; value: string } => (item.value?.length ?? 0) >= 8,
  );

  const problems: string[] = [];
  let scanned = 0;
  for (const path of files(DIRECTORY)) {
    scanned += 1;
    const text = readFileSync(path, "utf8");
    for (const name of SERVER_ONLY_NAMES) {
      if (text.includes(name)) problems.push(`${path}: згадується серверна змінна ${name}`);
    }
    for (const { name, value } of secretValues) {
      // Значення секрету в повідомлення не виводимо, лише назву змінної.
      if (text.includes(value)) problems.push(`${path}: знайдено значення змінної ${name}`);
    }
  }

  if (problems.length > 0) {
    console.error(`Секрети у файлах для браузера:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Перевірено файлів: ${scanned}. Серверних змінних і значень секретів у файлах для браузера немає.`,
  );
}

try {
  main();
} catch (error) {
  console.error("Помилка:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
