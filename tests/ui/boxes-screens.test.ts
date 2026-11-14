import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("сторінка сканера закрита за ролями, а продаж бокса лише власнику й старшому локації", () => {
    const page = read("src/app/(app)/boxes/scan/page.tsx");
    for (const role of ['"owner"', '"location_lead"', '"production"']) expect(page).toContain(role);
    const order = read("src/app/(app)/orders/[id]/page.tsx");
    expect(order).toContain('user.role === "owner" || user.role === "location_lead"');
    expect(read("src/components/productionPage/ProductionCard.tsx")).toContain("boxesIssued");
  });
});
