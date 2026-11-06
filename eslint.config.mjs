import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Вимикає правила стилю, що конфліктують із Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "drizzle/**", "next-env.d.ts"]),
]);
