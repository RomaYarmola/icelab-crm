import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки екрана «Готівка» (B6, PR 3): складений зі спільних цеглинок, дотримується
 * вимог ТЗ до мобільного екрана (шрифт від 16 px, кнопки від 44 px, статус словом), віддає лише
 * суму до сплати й прийняте (D68), а запис і сторно доступні лише тим, кому їх дає матриця прав.
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

const screenFiles = sourceFiles("src/components/cashPage");

describe("екран «Готівка»: правила оформлення", () => {
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

  it("оплату підписано словом («Сплачено», «Частково», «Не сплачено»), а не лише кольором", () => {
    const card = read("src/components/cashPage/CashOrderCard.tsx");
    for (const word of ["Сплачено", "Частково", "Не сплачено"]) expect(card).toContain(word);
    expect(card).toContain("<StatusChip");
  });

  it("суми форматуються спільною функцією, без ICU-символу валюти", () => {
    for (const file of ["CashOrderCard.tsx", "CashSummary.tsx", "CashEntryForm.tsx"]) {
      expect(read(`src/components/cashPage/${file}`), file).toContain("formatMoney");
    }
  });
});

describe("екран «Готівка»: гроші й права", () => {
  it("на екрані лише суми до сплати й прийняте: жодних цін за кг і позицій", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/pricePerKg|priceChanges|\.items\b|price_per_kg/);
      expect(source, file).not.toMatch(/(?:^|[^\p{L}])(?:ціна за кг|ціну за кг|позиці)/iu);
    }
  });

  it("сторінка читає готівку лише через listCashDay, а не через список чи картку замовлення", () => {
    const page = read("src/app/(app)/more/cash/page.tsx");
    expect(page).toContain("listCashDay");
    expect(page).not.toContain("listOrders");
    expect(page).not.toContain("getOrder(");
  });

  it("розділ закрито за правами; запис для власника й старшого локації, сторно лише для власника", () => {
    const layout = read("src/app/(app)/more/cash/layout.tsx");
    expect(layout).toContain('requirePageUser("cash")');
    const page = read("src/app/(app)/more/cash/page.tsx");
    expect(page).toContain('can(user.role, "order_cash", "write")');
    expect(page).toContain("isBotOnly");
    expect(page).toContain('can(user.role, "cash_reversal", "write")');
  });

  it("форма запису: сума за замовчуванням дорівнює залишку, підказка «Лишилось», сторно з причиною", () => {
    const form = read("src/components/cashPage/CashEntryForm.tsx");
    expect(form).toContain("Лишилось");
    expect(form).toContain("remainingSum");
    expect(form).toContain('name="amount"');
    const reverse = read("src/components/cashPage/ReverseEntryForm.tsx");
    expect(reverse).toContain('name="reason"');
    expect(reverse).toContain("required");
  });

  it("сторновані записи видно, але вони не дають форми сторно вдруге", () => {
    const card = read("src/components/cashPage/CashOrderCard.tsx");
    expect(card).toContain("isReversed");
    expect(card).toContain("line-through");
    expect(card).toMatch(/canReverse && !entry\.isReversed && !settled/);
  });

  it("картка замовлення веде на готівку, а екран виробництва для старшого локації теж", () => {
    expect(read("src/components/ordersPage/OrderCardContent.tsx")).toContain("cashHref");
    expect(read("src/components/productionPage/ProductionPageContent.tsx")).toContain(
      'href="/more/cash"',
    );
  });
});
