import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки екранів замовлень (B5, PR 2): вони складені зі спільних цеглинок,
 * дотримуються вимог ТЗ до мобільного екрана (шрифт від 16 px, кнопки від 44 px) і не віддають
 * грошей ролям, які їх не бачать.
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

const screenFiles = sourceFiles("src/components/ordersPage");

describe("екрани замовлень: правила оформлення", () => {
  it("кольори лише з токенів: жодного hex-кольору чи довільного кольору в класах", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-\[(?:#|rgb)/);
    }
  });

  it("шрифт від 16 px: немає text-xs, text-sm і розмірів у пікселях", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
    }
  });

  it("без горизонтальної прокрутки і без власної плавності", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])(?:duration|ease)-[\w[\].]+/);
    }
  });

  it("телефон отримувача натискається і набирає номер, зона від 44 px", () => {
    const summary = read("src/components/ordersPage/OrderSummary.tsx");
    expect(summary).toContain("tel:");
    expect(summary).toContain("min-h-11");
  });

  it("плашки днів і фільтри збирають стан в адресі сторінки", () => {
    const chips = read("src/components/ordersPage/DayChips.tsx");
    expect(chips).toContain("useUrlParams");
    expect(chips).toContain("ORDER_LIST_PARAMS.day");
    expect(read("src/components/shared/search/useUrlParams.ts")).toContain("router.replace");
    expect(read("src/components/ordersPage/OrderFilters.tsx")).toContain("FilterSelect");
  });

  it("список довантажується кнопкою «Показати ще»", () => {
    expect(read("src/components/ordersPage/OrdersList.tsx")).toContain("LoadMoreButton");
  });

  it("гривня форматується без ICU-символу валюти: сервер і браузер дають однаковий текст", () => {
    // Node пише «₴», браузер «грн»: різниця ламала гідратацію екранів із сумами.
    const format = read("src/utils/formatNumber.ts");
    // Рядок-коментар про це слово не рахуємо: шукаємо лише справжній параметр форматера.
    expect(format).not.toMatch(/^\s*style:\s*"currency"/m);
    expect(format).toContain("₴");
  });
});

describe("екрани замовлень: гроші й права", () => {
  it("ціни, суми й зміни ціни показуємо лише коли сервер їх віддав", () => {
    const items = read("src/components/ordersPage/OrderItemsList.tsx");
    expect(items).toContain("item.price !== undefined");
    expect(items).toContain("item.amount !== undefined");
    expect(items).toContain("total !== undefined");
    const row = read("src/components/ordersPage/OrderListRow.tsx");
    expect(row).toContain("order.total !== undefined");
    const summary = read("src/components/ordersPage/OrderSummary.tsx");
    expect(summary).toContain("order.paymentKind !== undefined");
    expect(summary).toContain("order.internalComment !== undefined");
  });

  it("кнопки переходів беруться з правил за роллю, а не вигадуються на екрані", () => {
    const page = read("src/app/(app)/orders/[id]/page.tsx");
    expect(page).toContain("transitionOptions(order.status, user.role)");
    expect(page).toContain('can(user.role, "order_price_override", "write")');
    expect(page).toContain("canDeleteDraft(order.status, user.role)");
  });

  it("чуже замовлення чи некоректний id дають 404", () => {
    const page = read("src/app/(app)/orders/[id]/page.tsx");
    expect(page).toContain("notFound()");
    expect(page).toContain("z.uuid()");
  });

  it("зміна ціни після підтвердження лише для власника і лише з приміткою", () => {
    const form = read("src/components/ordersPage/OrderPriceForm.tsx");
    expect(form).toContain('name="note"');
    expect(form).toContain("required");
    const card = read("src/components/ordersPage/OrderCardContent.tsx");
    expect(card).toContain("permissions.canOverridePrice");
  });

  it("скасування, крок назад і ручне «Оплачено» ховаються за полем причини", () => {
    const form = read("src/components/ordersPage/OrderTransitionForm.tsx");
    expect(form).toContain("needsNote");
    expect(form).toContain("<Disclosure");
    expect(form).toContain('name="note"');
  });
});
