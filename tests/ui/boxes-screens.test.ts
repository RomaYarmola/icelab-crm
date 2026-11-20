import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCAN_CACHE_NAME } from "@/constants/boxes";

/**
 * Охоронні перевірки екранів боксів (B9, PR 2): складені зі спільних цеглинок, без серверних бібліотек
 * у браузері, а доступ до реєстру й PDF закритий за ролями.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const screenFiles = sourceFiles("src/components/boxesPage");

describe("екрани боксів: правила оформлення", () => {
  it("кольори з токенів, шрифт від 16 px, без горизонтальної прокрутки й власної плавності", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-\[(?:#|rgb)/);
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])(?:duration|ease)-[\w[\].]+/);
    }
  });

  it("у браузер не потрапляють QR, PDF і сервер: компоненти беруть константи з `constants/boxes`", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/from "qrcode"|from "pdf-lib"|@\/server\/box-labels/);
      expect(source, file).not.toMatch(/from "@\/db\//);
    }
    expect(read("src/constants/boxes.ts")).not.toMatch(/import /);
    expect(read("src/utils/boxListParams.ts")).not.toMatch(/box-labels/);
  });
});

describe("екрани боксів: права", () => {
  it("розділ закрито в layout, реєстр і форма лише для власника й старшого локації", () => {
    expect(read("src/app/(app)/boxes/layout.tsx")).toContain('requirePageUser("boxes")');
    for (const page of ["src/app/(app)/boxes/page.tsx", "src/app/(app)/boxes/new/page.tsx"]) {
      const source = read(page);
      expect(source, page).toContain('requirePageUser("boxes")');
      expect(source, page).toContain('"owner"');
      expect(source, page).toContain('"location_lead"');
    }
  });

  it("PDF з наклейками віддає лише вхід + власник чи старший локації, не кешується", () => {
    const route = read("src/app/api/boxes/labels/route.ts");
    expect(route).toContain("requireUser()");
    expect(route).toContain('"owner"');
    expect(route).toContain('"location_lead"');
    expect(route).toContain("status: 403");
    expect(route).toContain("status: 422");
    expect(route).toContain("no-store");
    expect(route).toContain("application/pdf");
  });

  it("реєстр читає лише `listBoxes`, а серверні функції самі перевіряють роль", () => {
    expect(read("src/app/(app)/boxes/page.tsx")).toContain("listBoxes");
    const server = read("src/server/boxes.ts");
    expect(server).toContain('requirePermission(actor, "box_scan", "write"');
    expect(server).toContain("assertCanManageRegistry");
  });

  it("адреса QR `/b/<код>` вимагає вхід і веде на картку бокса", () => {
    const page = read("src/app/(app)/b/[code]/page.tsx");
    expect(page).toContain("requireUser()");
    expect(page).toContain("/boxes/${code}");
  });
});

describe("сканер боксів (B9, PR 3)", () => {
  it("камера й бібліотека сканування вантажаться лише за натисканням, одним динамічним імпортом", () => {
    const source = read("src/components/boxesPage/BoxScanner.tsx");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain('await import("@zxing/browser")');
    expect(source).not.toMatch(/^import .*@zxing/m);
    // Серверне лише типи й чиста функція розбору коду.
    expect(source).not.toMatch(/from "@\/db\//);
    expect(source).toContain("Видача");
    expect(source).toContain("Повернення");
    expect(source).toContain("Код вручну");
  });

  it("адреса подій вимагає вхід, перевіряє тіло, віддає 400 і 403, не кешується", () => {
    const route = read("src/app/api/boxes/events/route.ts");
    expect(route).toContain("requireUser()");
    expect(route).toContain("status: 400");
    expect(route).toContain("status: 403");
    expect(route).toContain("no-store");
    expect(route).toContain("MAX_EVENTS_PER_BATCH");
    expect(route).toContain("notifyOrderChange");
  });

  it("продажу боксів на картці замовлення немає (ми продаємо лише лід), лічильник боксів на картці цеху є", () => {
    const order = read("src/app/(app)/orders/[id]/page.tsx");
    expect(order).not.toContain("sellBoxAction");
    expect(read("src/components/boxesPage/OrderBoxes.tsx")).not.toContain("Продати бокс");
    expect(read("src/components/productionPage/ProductionCard.tsx")).toContain("boxesIssued");
  });
});

describe("сканер офлайн (B9, PR 4, D112)", () => {
  it("сторінка /scan нейтральна: без даних користувача, лише оболонка й сканер", () => {
    const page = read("src/app/scan/page.tsx");
    expect(page).toContain("<BoxScanner />");
    expect(page).not.toMatch(/requireUser|requirePageUser|getDb|listBox/);
    const layout = read("src/app/scan/layout.tsx");
    expect(layout).not.toMatch(/requireUser|getDb|cookies|headers/);
  });

  it("замовлення для видачі віддає лише API з перевіркою входу й ролі, а стара адреса веде на /scan", () => {
    const api = read("src/app/api/boxes/orders/route.ts");
    expect(api).toContain("requireUser()");
    expect(api).toContain("status: 403");
    expect(api).toContain("no-store");
    expect(api).toContain("listBoxIssueOrders");
    expect(read("src/app/(app)/boxes/scan/page.tsx")).toContain('"/scan');
    expect(read("src/components/productionPage/ProductionCard.tsx")).toContain("/scan?order=");
  });

  it("скан спершу пишеться в чергу, потім відправляється; є індикатор мережі й «Відправити зараз»", () => {
    const source = read("src/components/boxesPage/BoxScanner.tsx");
    expect(source.indexOf("store.queue.put(item)")).toBeGreaterThan(-1);
    expect(source.indexOf("store.queue.put(item)")).toBeLessThan(source.indexOf("await sync()"));
    for (const text of [
      "Немає зв'язку",
      "Не відправлено",
      "Відправити зараз",
      "Потребують уваги",
      "Повторити",
      "Видалити",
    ]) {
      expect(source, text).toContain(text);
    }
    expect(source).toContain('addEventListener("online"');
    // Запасний варіант, якщо IndexedDB недоступний.
    expect(source).toContain("memoryQueue");
  });

  it("сервіс-воркер кешує лише /scan серед сторінок, і це записано в коментарі", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('const SCAN_PATH = "/scan"');
    expect(sw.match(/mode === "navigate"/g)).toHaveLength(2);
    expect(sw).toContain("!response.redirected");
    // Назва кешу в коді сканера збігається з тією, що в service worker.
    expect(sw).toContain(`"${SCAN_CACHE_NAME}"`);
  });

  it("на сторінці входу прибираємо збережену оболонку й список замовлень, але не невідправлені скани", () => {
    expect(read("src/app/login/page.tsx")).toContain("<ClearScanData />");
    const clear = read("src/components/loginPage/ClearScanData.tsx");
    expect(clear).toContain("caches.delete(SCAN_CACHE_NAME)");
    expect(clear).not.toContain("queue.clear");
    expect(clear).not.toContain(".clear()");
  });
});

describe("екрани боксів: борги, склад, клієнт (B9, PR 5)", () => {
  it("борги й склад закриті для виробництва, реєстр лише для власника й старшого локації", () => {
    for (const page of ["debts", "stock"]) {
      const source = read(`src/app/(app)/boxes/${page}/page.tsx`);
      expect(source).toContain('requirePageUser("boxes")');
      expect(source).toContain('user.role === "production"');
      expect(source).toContain('redirect("/scan")');
    }
    expect(read("src/app/(app)/boxes/page.tsx")).toContain('redirect("/boxes/debts")');
  });

  it("вкладка «Бокси» на картці клієнта є лише тим, хто бачить борги, і не для виробництва", () => {
    const page = read("src/app/(app)/clients/[id]/page.tsx");
    expect(page).toContain('"box_debts_stock", "read"');
    expect(page).toContain('user.role !== "production"');
    expect(read("src/components/clientsPage/ClientCardContent.tsx")).toContain(
      'id !== "boxes" || boxes !== null',
    );
  });

  it("старі борги вносять і закривають лише власник і старший локації, переміщує лише власник", () => {
    const server = read("src/server/box-debts.ts");
    expect(server).toContain("assertCanManageLegacy(actor)");
    expect(server).toMatch(/owner.*location_lead|location_lead.*owner/s);
    expect(read("src/app/(app)/boxes/[code]/page.tsx")).toContain('user.role === "owner"');
  });
});
