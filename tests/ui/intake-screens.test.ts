import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Охоронні перевірки екрана «Прийом заявок» і приймача Telegram (B11, PR 1). */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const screenFiles = readdirSync(join(ROOT, "src/components/intakePage")).map(
  (name) => `src/components/intakePage/${name}`,
);

describe("екран «Прийом заявок»", () => {
  it("розділ закритий і в layout, і на сторінці; серверні функції вимагають право власника", () => {
    expect(read("src/app/(app)/intake/layout.tsx")).toContain('requirePageUser("intake")');
    expect(read("src/app/(app)/intake/page.tsx")).toContain('requirePageUser("intake")');
    const admin = read("src/server/telegram/admin.ts");
    expect(admin).toContain('"migration_settings", "write"');
    expect(admin.match(/assertOwner\(actor\)/g)!.length).toBeGreaterThanOrEqual(7);
  });

  it("токен і секрет не читаються в компонентах і діях, лише в серверних модулях Telegram", () => {
    for (const file of [...screenFiles, "src/app/(app)/intake/actions.ts"]) {
      expect(read(file), file).not.toMatch(
        /process\.env|getTelegramToken|getTelegramWebhookSecret/,
      );
    }
    expect(read("src/server/telegram/client.ts")).toContain("process.env.TELEGRAM_BOT_TOKEN");
    const bundle = read("scripts/check-bundle.ts");
    for (const name of [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "LEAD_SITE_SECRET",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(bundle, name).toContain(name);
    }
  });

  it("кольори з токенів, шрифт від 16 px, без прокрутки вбік, без серверних бібліотек у компонентах", () => {
    for (const file of screenFiles.filter((f) => f.endsWith(".tsx"))) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toMatch(/from "@\/db\//);
    }
  });

  it("приймач без сесії лише для Telegram і сайту, секрет перевіряється до будь-якої роботи", () => {
    expect(read("src/lib/supabase/proxy.ts")).toContain('"/api/telegram/webhook"');
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route.indexOf("isTelegramRequest(request)")).toBeLessThan(
      route.indexOf("handleUpdate("),
    );
    expect(route).toContain("status: 401");
    expect(read("src/server/telegram/webhook-auth.ts")).toContain("timingSafeEqual");
  });
});
