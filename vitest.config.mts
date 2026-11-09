import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Тести бази піднімають PGlite і застосовують міграції, це займає кілька секунд.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
