import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки експорту (B8, PR 2, D92–D96): кнопка й екран «Експорт усього» складені зі
 * спільних цеглинок, не тягнуть серверний код у браузер, а доступ закритий і на сторінці, і на
 * адресі `/api/export`.
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

const screenFiles = [
  ...sourceFiles("src/components/exportPage"),
  ...sourceFiles("src/components/shared/export"),
];

describe("експорт: правила оформлення", () => {
  it("кольори лише з токенів, шрифт від 16 px, без горизонтальної прокрутки й власної плавності", () => {
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

  it("кнопка складена зі спільних цеглинок і показує помилку та успіх повідомленням", () => {
    const button = read("src/components/shared/export/ExportButton.tsx");
    expect(button).toContain("MainButton");
    expect(button).toContain("Notification");
    expect(button).toContain("Готуємо файл");
    // Помилки: немає прав, надто багато рядків (текст з сервера), завершена сесія, немає зв'язку.
    expect(button).toContain("Недостатньо прав");
    expect(button).toContain("422");
    expect(button).toContain("Сесія завершилась");
    expect(button).toContain("Немає зв'язку");
  });

  it("кнопка не тягне серверний код у браузер (бібліотека XLSX лише на сервері)", () => {
    const button = read("src/components/shared/export/ExportButton.tsx");
    expect(button.startsWith('"use client"')).toBe(true);
    expect(button).not.toMatch(/from "@\/server\//);
    expect(button).not.toMatch(/write-excel-file/);
    for (const file of screenFiles) {
      expect(read(file), file).not.toMatch(/from "@\/db\//);
    }
    expect(read("src/constants/export.ts")).not.toMatch(/import /);
  });
});

describe("експорт: права", () => {
  it("адреса `/api/export` вимагає вхід, мапить помилки на 403 і 422 і не кешується", () => {
    const route = read("src/app/api/export/[list]/route.ts");
    expect(route).toContain("requireUser()");
    expect(route).toContain("isExportList");
    expect(route).toContain("status: 404");
    expect(route).toContain("status: 403");
    expect(route).toContain("status: 422");
    expect(route).toContain("no-store");
    expect(route).toContain("attachment");
    // Права й межі локації перевіряє сервер у функціях експорту, а не ця адреса.
    expect(route).not.toMatch(/\.role\b/);
  });

  it("функції експорту вимагають право перед будь-яким читанням", () => {
    const server = read("src/server/export.ts");
    expect(server.match(/requirePermission\(actor, "excel_export", "write"\)/g)).toHaveLength(3);
    expect(server).toContain('requirePermission(actor, "export_all", "write")');
    // Списки читаються тими самими функціями, що й екрани: права й локація діють так само.
    expect(server).toContain("listOrders(");
    expect(server).toContain("listClients(");
    expect(server).toContain("listCashDay(");
  });

  it("екран «Експорт усього» закритий і в layout, і на самій сторінці", () => {
    expect(read("src/app/(app)/more/export/layout.tsx")).toContain('requirePageUser("export")');
    expect(read("src/app/(app)/more/export/page.tsx")).toContain('requirePageUser("export")');
  });

  it("кнопка на списках лише для тих, хто має право на експорт", () => {
    for (const [page, content] of [
      ["src/app/(app)/orders/page.tsx", "src/components/ordersPage/OrdersPageContent.tsx"],
      ["src/app/(app)/clients/page.tsx", "src/components/clientsPage/ClientsPageContent.tsx"],
      ["src/app/(app)/more/cash/page.tsx", "src/components/cashPage/CashPageContent.tsx"],
    ] as const) {
      expect(read(page), page).toContain('canExport={can(user.role, "excel_export", "write")}');
      expect(read(content), content).toMatch(/canExport \? <ExportButton list="\w+"/);
    }
  });

  it("журнал експортів: таблицю пише лише код експорту, а запис не змінюють", () => {
    const migration = read("drizzle/0011_exports_log.sql");
    expect(migration).toContain("CREATE TRIGGER exports_audit");
    expect(migration).toContain("CREATE TRIGGER exports_guard");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON exports");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    const server = read("src/server/export.ts");
    expect(server).toContain("withActor(db, actor.id");
  });
});
