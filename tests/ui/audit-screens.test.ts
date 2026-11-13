import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки екрана «Журнал змін» і «Історії змін» на картках (B8, PR 1, D89–D91): складені
 * зі спільних цеглинок, дотримуються вимог ТЗ до мобільного екрана і не віддають зміни тим, кому їх
 * не можна бачити.
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

const screenFiles = sourceFiles("src/components/auditPage");

describe("журнал змін: правила оформлення", () => {
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

  it("довгий текст переноситься, а зміни показуються як «було → стало»", () => {
    const card = read("src/components/auditPage/AuditEntryCard.tsx");
    expect(card).toContain("break-words");
    expect(card).toContain("→");
    expect(card).toContain("Показати поля");
  });

  it("список довантажується кнопкою «Показати ще», фільтри й пошук живуть в адресі сторінки", () => {
    expect(read("src/components/auditPage/AuditList.tsx")).toContain("LoadMoreButton");
    const filters = read("src/components/auditPage/AuditFilters.tsx");
    expect(filters).toContain("useUrlParams");
    expect(filters).toContain("FilterSelect");
    expect(read("src/components/auditPage/AuditPageContent.tsx")).toContain("SearchField");
  });
});

describe("журнал змін: права", () => {
  it("розділ закрито за правами, а дані читає лише listAuditEntries", () => {
    expect(read("src/app/(app)/more/audit/layout.tsx")).toContain('requirePageUser("audit")');
    const page = read("src/app/(app)/more/audit/page.tsx");
    // Layout і сторінка рендеряться паралельно, тож сторінка теж перенаправляє заборонену роль.
    expect(page).toContain('requirePageUser("audit")');
    expect(page).toContain("listAuditEntries");
    expect(page).not.toMatch(/auditLog|from\("audit_log"\)/);
    const actions = read("src/app/(app)/more/audit/actions.ts");
    expect(actions).toContain("listAuditEntries");
  });

  it("сервер перевіряє право audit_log на читання журналу й order_money чи client_prices на історію", () => {
    const server = read("src/server/audit.ts");
    expect(server).toContain('requirePermission(actor, "audit_log", "read")');
    expect(server).toContain('requirePermission(actor, "order_money", "read")');
    expect(server).toContain('requirePermission(actor, "client_prices", "read")');
  });

  it("історія на картках є лише в ролей з грошима", () => {
    const orderPage = read("src/app/(app)/orders/[id]/page.tsx");
    expect(orderPage).toContain('can(user.role, "order_money", "read")');
    expect(orderPage).toContain("listEntityHistory");
    const clientPage = read("src/app/(app)/clients/[id]/page.tsx");
    expect(clientPage).toContain('can(user.role, "client_prices", "read")');
    expect(clientPage).toContain("listEntityHistory");
    // На картках лише вид запису, а посилання й заголовки лишаються журналу.
    expect(read("src/components/auditPage/EntityHistory.tsx")).toContain("showSubject={false}");
  });

  it("вкладка «Історія» картки клієнта прихована для ролей без права", () => {
    const card = read("src/components/clientsPage/ClientCardContent.tsx");
    expect(card).toContain('id !== "history" || canSeeHistory');
  });
});
