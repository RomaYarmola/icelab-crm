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

describe("розклад і підбір адрес (B10, PR 2)", () => {
  it("адреса розкладу без сесії, але з секретом у заголовку; ключі розкладу не потрапляють у збірку", () => {
    expect(read("src/lib/supabase/proxy.ts")).toContain('pathname.startsWith("/api/cron/")');
    const route = read("src/app/api/cron/np-directories/route.ts");
    expect(route).toContain("isCronRequest(request)");
    expect(route).toContain("status: 401");
    expect(read("src/server/cron-auth.ts")).toContain("timingSafeEqual");
    expect(read("scripts/check-bundle.ts")).toContain("CRON_SECRET");
  });

  it("підбір адреси на картці клієнта лише для тих, хто її редагує; серверні функції перевіряють право", () => {
    expect(read("src/components/clientsPage/AddressesTab.tsx")).toContain("canEdit && actions.np");
    const server = read("src/server/np/addresses.ts");
    expect(server.match(/requirePermission\(actor, "clients", "write"\)/g)).toHaveLength(3);
    expect(server.match(/requirePermission\(actor, "migration_settings", "write"\)/g)).toHaveLength(
      2,
    );
  });
});

describe("«ТТН на день» (B10, PR 4)", () => {
  it("розділ закритий і в layout, і на сторінці; серверна функція перевіряє право", () => {
    expect(read("src/app/(app)/shipments/layout.tsx")).toContain('requirePageUser("shipments")');
    expect(read("src/server/np/shipment-day.ts")).toContain('"shipments", "write"');
    expect(read("src/app/(app)/shipments/actions.ts")).toContain("createShipment(");
  });

  it("черга: не більше двох одночасно, по одному замовленню на запит, стікери склеює браузер за потреби", () => {
    const list = read("src/components/shipmentsPage/ShipmentDayList.tsx");
    expect(list).toContain("const CONCURRENCY = 2");
    expect(list).toContain("actions.createStep(orderId)");
    expect(list).toContain('await import("pdf-lib")');
    expect(list).not.toMatch(/from "pdf-lib"/);
    expect(list).not.toMatch(/apiKey|NOVA_POSHTA|process\.env/);
  });
});
