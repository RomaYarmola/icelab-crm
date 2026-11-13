import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки екрана виробництва (B6, PR 2): складений зі спільних цеглинок, дотримується
 * вимог ТЗ до цеху (шрифт від 16 px, кнопки від 44 px, статус словом, контраст), не має ні цін, ні
 * сум, а режим «на стіні» лише для перегляду й лише для старшого локації.
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

const screenFiles = sourceFiles("src/components/productionPage");

describe("екран виробництва: правила оформлення", () => {
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

  it("великі розміри тексту (кг, режим «на стіні») беруться з токенів globals.css", () => {
    const css = read("src/app/globals.css");
    for (const token of ["--text-hero:", "--text-wall:", "--text-wall-title:"]) {
      expect(css, token).toContain(token);
    }
    const card = read("src/components/productionPage/ProductionCard.tsx");
    expect(card).toContain("text-hero");
    expect(card).toContain("text-wall");
  });

  it("головні кнопки цеху від 56 px, решта від 44 px", () => {
    expect(read("src/components/shared/buttons/buttonStyles.ts")).toContain('lg: "min-h-14');
    const actions = read("src/components/productionPage/ProductionCardActions.tsx");
    expect(actions).toContain('size="lg"');
    // Стрілки днів теж не менші за 44 px.
    expect(read("src/components/productionPage/ProductionDayNav.tsx")).toContain("size-11");
  });

  it("статус підписано словом, «Нове» теж слово, а не лише колір", () => {
    const card = read("src/components/productionPage/ProductionCard.tsx");
    expect(card).toContain("<StatusChip");
    expect(card).toContain("Нове");
  });
});

describe("екран виробництва: жодних цін і сум", () => {
  it("у компонентах немає форматування грошей, знака гривні й слів про ціну чи суму", () => {
    for (const file of screenFiles) {
      const source = read(file);
      expect(source, file).not.toContain("formatMoney");
      expect(source, file).not.toContain("₴");
      expect(source, file).not.toMatch(/\b(?:price|amount|total|cash|payment)\w*\b/i);
      expect(source, file).not.toMatch(/(?:^|[^\p{L}])(?:ціна|ціни|ціну|сума|суми|оплат)/iu);
    }
  });

  it("сторінка бере дані лише з listProductionQueue, а не з картки замовлення", () => {
    const page = read("src/app/(app)/production/page.tsx");
    expect(page).toContain("listProductionQueue");
    expect(page).not.toContain("listOrders");
    expect(page).not.toContain("getOrder(");
  });

  it("розділ закрито за правами, а режим «на стіні» лише для старшого локації", () => {
    const page = read("src/app/(app)/production/page.tsx");
    expect(page).toContain('requirePageUser("production")');
    expect(page).toMatch(/params\.wall && isLead/);
    // Власник і менеджер лише читають: кнопки змін і «Нове» знімають лише цех і старший локації.
    expect(page).toMatch(/canWork = isLead \|\| user\.role === "production"/);
  });

  it("у режимі «на стіні» картка без кнопок змін", () => {
    const card = read("src/components/productionPage/ProductionCard.tsx");
    expect(card).toMatch(/!wall && canWork/);
  });
});

describe("екран виробництва: живе оновлення і режим «на стіні»", () => {
  it("канал Realtime слухає лише порожній сигнал, дані не читає", () => {
    const hook = read("src/components/productionPage/useProductionLive.ts");
    expect(hook).toContain("RealtimeClient");
    expect(hook).toContain('"broadcast"');
    // Браузер не звертається до таблиць: жодного запиту до бази чи PostgREST.
    expect(hook).not.toContain("postgres_changes");
    expect(hook).not.toContain(".from(");
    expect(hook).toContain("router.refresh");
  });

  it("є запасне опитування: рідше при живому каналі, частіше без нього, не при прихованій вкладці", () => {
    const hook = read("src/components/productionPage/useProductionLive.ts");
    expect(hook).toContain("liveIntervalMs");
    expect(hook).toContain("fallbackIntervalMs");
    expect(hook).toContain('visibilityState === "visible"');
    const constants = read("src/constants/production.ts");
    expect(constants).toMatch(/liveIntervalMs:\s*45_000/);
    expect(constants).toMatch(/fallbackIntervalMs:\s*15_000/);
  });

  it("екран не гасне: Screen Wake Lock із поверненням при поверненні на вкладку", () => {
    const lock = read("src/components/productionPage/useWakeLock.ts");
    expect(lock).toContain("navigator.wakeLock.request");
    expect(lock).toContain("visibilitychange");
  });

  it("звук вимкнено за замовчуванням і вмикається дотиком; налаштування пристрою в localStorage", () => {
    const settings = read("src/components/productionPage/deviceSettings.ts");
    expect(settings).toContain("localStorage");
    expect(settings).toContain("() => false");
    const toggles = read("src/components/productionPage/DeviceToggles.tsx");
    expect(toggles).toContain("playAlertSound");
  });

  it("режим «на стіні» лежить над шапкою й меню, але під банером «Немає зв'язку»", () => {
    const content = read("src/components/productionPage/ProductionPageContent.tsx");
    expect(content).toContain("fixed inset-0 z-45");
    expect(read("src/components/shared/navigation/BottomNav.tsx")).toContain("z-40");
    expect(read("src/components/shared/notification/OfflineNotification.tsx")).toContain("z-50");
  });
});
