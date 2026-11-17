import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Охоронні перевірки екрана «Нова Пошта» (B10, PR 1): права, ключ, оформлення. */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const screenFiles = readdirSync(join(ROOT, "src/components/npPage")).map(
  (name) => `src/components/npPage/${name}`,
);

describe("екран «Нова Пошта»", () => {
  it("розділ закритий і в layout, і на сторінці, лише власник", () => {
    expect(read("src/app/(app)/np/layout.tsx")).toContain('requirePageUser("np")');
    expect(read("src/app/(app)/np/page.tsx")).toContain('requirePageUser("np")');
    expect(read("src/server/np/settings.ts")).toContain('"migration_settings", "write"');
  });

  it("значення ключа не читається ні в компонентах екрана, ні в діях: лише в клієнті API на сервері", () => {
    for (const file of [...screenFiles, "src/app/(app)/np/actions.ts"]) {
      expect(read(file), file).not.toMatch(/apiKey|process\.env/);
    }
    expect(read("src/server/np/client.ts")).toContain("process.env.NOVA_POSHTA_API_KEY");
    expect(read("scripts/check-bundle.ts")).toContain("NOVA_POSHTA_API_KEY");
  });

  it("кольори з токенів, шрифт від 16 px, без прокрутки вбік; компоненти без серверних бібліотек", () => {
    for (const file of screenFiles.filter((f) => f.endsWith(".tsx"))) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toMatch(/from "@\/db\//);
    }
  });
});
