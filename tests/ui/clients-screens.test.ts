import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки екранів клієнтів і прайсу (B4, PR 2): вони складені зі спільних цеглинок
 * і дотримуються вимог ТЗ до мобільного екрана (шрифт від 16 px, кнопки від 44 px).
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

const SCREEN_DIRS = [
  "src/components/clientsPage",
  "src/components/pricesPage",
  "src/components/shared/search",
  "src/components/shared/tabs",
  "src/components/shared/disclosure",
  "src/components/shared/detailList",
];
const screenFiles = SCREEN_DIRS.flatMap(sourceFiles);

describe("екрани клієнтів: правила оформлення", () => {
  it("кольори лише з токенів: жодного hex-кольору чи довільного кольору в класах", () => {
    for (const file of screenFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-\[(?:#|rgb)/);
    }
  });

  it("шрифт від 16 px: немає text-xs, text-sm і розмірів у пікселях", () => {
    for (const file of screenFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
    }
  });

  it("жодної горизонтальної прокрутки: немає overflow-x-auto і фіксованих широких блоків", () => {
    for (const file of screenFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toContain("overflow-x-scroll");
    }
  });

  it("кнопки, посилання й підписи, що натискаються, мають висоту від 44 px", () => {
    expect(read("src/components/shared/tabs/TabLinks.tsx")).toContain("min-h-11");
    expect(read("src/components/shared/disclosure/Disclosure.tsx")).toContain("min-h-11");
    expect(read("src/components/shared/customizedInput/Checkbox.tsx")).toContain("min-h-11");
    // Телефон у картці контакту теж натискається: набирає номер.
    expect(read("src/components/clientsPage/ContactsTab.tsx")).toContain("min-h-11");
    // Поле пошуку тієї ж висоти, що й решта полів.
    expect(read("src/components/shared/search/SearchField.tsx")).toContain("getFieldClassName");
  });

  it("плавність лише єдина: у новому коді немає власних duration-* чи ease-*", () => {
    for (const file of screenFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])(?:duration|ease)-[\w[\].]+/);
    }
  });
});

describe("пошук, вкладки й телефон", () => {
  it("пошук запускається через 300 мс і зберігає стан в адресі сторінки (D47)", () => {
    const search = read("src/components/shared/search/SearchField.tsx");
    expect(search).toMatch(/SEARCH_DEBOUNCE_MS = 300/);
    expect(search).toContain("setTimeout");
    expect(search).toContain('event.key === "Enter"');
    const hook = read("src/components/shared/search/useUrlParam.ts");
    expect(hook).toContain("router.replace");
    expect(hook).toContain("window.location.search");
    // Нова вибірка починається з першої частини.
    expect(hook).toContain('params.delete("page")');
  });

  it("вкладки мають власні адреси і позначають активну для читалок", () => {
    const tabs = read("src/components/shared/tabs/TabLinks.tsx");
    expect(tabs).toContain("aria-current");
    expect(tabs).toContain("<Link");
    // Активна вкладка міняє колір і смужку, а не розмір шрифту.
    expect(tabs).not.toContain("font-bold");
  });

  it("поле телефону: цифрова клавіатура і впорядкований вигляд номера", () => {
    const phone = read("src/components/shared/customizedInput/PhoneField.tsx");
    expect(phone).toContain('type="tel"');
    expect(phone).toContain('inputMode="tel"');
    expect(phone).toContain("normalizePhone");
    expect(phone).toContain("formatPhone");
  });

  it("список довантажується кнопкою «Показати ще», а не нескінченною прокруткою", () => {
    expect(read("src/components/shared/buttons/LoadMoreButton.tsx")).toContain("Показати ще");
    expect(read("src/components/clientsPage/ClientsList.tsx")).toContain("LoadMoreButton");
  });
});

describe("екрани клієнтів: права і ціни", () => {
  it("вкладка «Ціни» лише коли ціни прийшли з сервера (ролям з правом на них)", () => {
    const card = read("src/components/clientsPage/ClientCardContent.tsx");
    expect(card).toContain("client.prices !== undefined");
    expect(card).toContain('id !== "prices" || canSeePrices');
    expect(card).toContain('activeTab === "prices" && client.prices');
  });

  it("видалення й об'єднання лише для власника", () => {
    const card = read("src/components/clientsPage/ClientCardContent.tsx");
    expect(card).toContain("permissions.isOwner");
    const merge = read("src/app/(app)/clients/[id]/merge/page.tsx");
    expect(merge).toContain('user.role !== "owner"');
  });

  it("форми зміни показуються лише тим, хто може змінювати, і не для видаленого клієнта", () => {
    const card = read("src/components/clientsPage/ClientCardContent.tsx");
    expect(card).toContain("permissions.canWrite && !client.isDeleted");
    for (const file of ["ContactsTab.tsx", "AddressesTab.tsx"]) {
      expect(read(join("src/components/clientsPage", file)), file).toContain("canEdit");
    }
  });

  it("прайс змінює лише власник: на екрані форма за правом default_prices", () => {
    const page = read("src/app/(app)/more/prices/page.tsx");
    expect(page).toContain('can(user.role, "default_prices", "write")');
    expect(read("src/app/(app)/more/prices/layout.tsx")).toContain('requirePageUser("prices")');
  });

  it("нового клієнта створюють лише ті, хто може змінювати клієнтів", () => {
    const page = read("src/app/(app)/clients/new/page.tsx");
    expect(page).toContain('can(user.role, "clients", "write")');
    expect(page).toContain('redirect("/clients")');
  });
});
