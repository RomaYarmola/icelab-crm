import { defineConfig } from "drizzle-kit";

// drizzle-kit сам не читає .env.local, тому підвантажуємо його вручну (Node 20.12+).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Файлу ще немає: DATABASE_URL може прийти зі змінних оболонки.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
