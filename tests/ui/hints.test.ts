import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INLINE_HINTS, SCREEN_HINTS, visibleHintItems } from "@/constants/hints";
import { ORDER_STATUS_LABELS } from "@/constants/orders";
import { can, ROLE_LABELS, USER_ROLES, type UserRole } from "@/server/permissions";

/**
 * Охоронні перевірки коротких підказок (B8, ТЗ §12, D102): тексти звірені з кодом і правами, не
 * розрослись, без жаргону, стоять на потрібних екранах.
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

const allTexts = [
  ...Object.values(SCREEN_HINTS).flatMap((hint) => [
    hint.title,
    ...hint.items.flatMap((item) => [item.term, item.text]),
  ]),
  ...Object.values(INLINE_HINTS),
];

describe("тексти підказок", () => {
  it("короткі: пункт до 220 символів, поняття до 40, рядок під елементом до 220", () => {
    for (const hint of Object.values(SCREEN_HINTS)) {
      expect(hint.title.length).toBeLessThanOrEqual(40);
      expect(hint.items.length).toBeGreaterThan(0);
      expect(hint.items.length).toBeLessThanOrEqual(8);
      for (const item of hint.items) {
        expect(item.term.length, item.term).toBeLessThanOrEqual(40);
        expect(item.text.length, item.term).toBeLessThanOrEqual(220);
      }
    }
    for (const [key, text] of Object.entries(INLINE_HINTS)) {
      expect(text.length, key).toBeLessThanOrEqual(220);
    }
  });

  it("прості речення: кожен пункт закінчується крапкою, без службових слів і латиниці", () => {
    const allowed = new Set(["Excel", "Telegram"]);
    for (const hint of Object.values(SCREEN_HINTS)) {
      for (const item of hint.items) expect(item.text, item.term).toMatch(/[.»]$/);
    }
    for (const [key, text] of Object.entries(INLINE_HINTS)) expect(text, key).toMatch(/\.$/);
    for (const text of allTexts) {
      for (const word of text.match(/[A-Za-z]{3,}/g) ?? []) {
        expect(allowed.has(word), `«${word}» у «${text}»`).toBe(true);
      }
    }
    for (const text of allTexts) {
      expect(text).not.toMatch(/\b(?:API|uuid|JSON|RLS|snapshot|webhook)\b/i);
    }
  });

  it("немає двох пунктів з однаковим поняттям у межах однієї підказки", () => {
    for (const [key, hint] of Object.entries(SCREEN_HINTS)) {
      const terms = hint.items.map((item) => item.term);
      expect(new Set(terms).size, key).toBe(terms.length);
    }
  });
});

describe("підказки збігаються з кодом", () => {
  it("«Що означають статуси» описує кожен статус замовлення, і лише їх", () => {
    const terms = SCREEN_HINTS.orderStatuses.items.map((item) => item.term).sort();
    expect(terms).toEqual(Object.values(ORDER_STATUS_LABELS).sort());
  });

  it("підказка екрана виробництва називає кнопки так, як вони підписані на екрані", () => {
    const source = sourceFiles("src/components/productionPage")
      .map((file) => read(file))
      .join("\n");
    const terms = SCREEN_HINTS.production.items.map((item) => item.term);
    for (const term of ["Нове", "Розпочати", "Готово", "На стіну", "Повернути в роботу"]) {
      expect(terms, term).toContain(term);
      expect(source, term).toContain(term);
    }
    expect(terms).toContain("Змінити кг чи коментар");
    expect(source).toContain("Змінити кг чи коментар");
  });

  it("підказка готівки називає суми так, як вони підписані на екрані", () => {
    const summary = read("src/components/cashPage/CashSummary.tsx");
    for (const term of ["Мало надійти", "Внесено", "Різниця"]) {
      expect(SCREEN_HINTS.cash.items.map((item) => item.term)).toContain(term);
      expect(summary, term).toContain(term);
    }
  });

  it("підказка ролей описує кожну роль із системи, і лише їх", () => {
    const terms = SCREEN_HINTS.roles.items.map((item) => item.term).sort();
    expect(terms).toEqual(Object.values(ROLE_LABELS).sort());
  });

  it("твердження про ролі не суперечать матриці прав", () => {
    const text = (role: UserRole) =>
      SCREEN_HINTS.roles.items.find((item) => item.term === ROLE_LABELS[role])!.text;
    // Лише ствердні речення: «Користувачів і журналу не бачить» нічого не стверджує про можливість.
    const claims = (role: UserRole) =>
      text(role)
        .split(/(?<=\.)\s+/)
        .filter((sentence) => !/\bне\b|\bнічого\b/.test(sentence))
        .join(" ");
    for (const role of USER_ROLES) {
      // Кому не можна бачити гроші, про суми й ціни клієнтів в описі не йдеться.
      if (!can(role, "order_money", "read")) {
        expect(claims(role), role).not.toMatch(/із сумами|ціни клієнтів/);
      }
      // Експорт у Excel згадано рівно тим, у кого є право (власнику через «експорт усього»).
      expect(/Excel|експорт/i.test(claims(role)), role).toBe(can(role, "excel_export", "write"));
      // Журнал змін описано рівно тим, у кого є право на читання.
      expect(/журнал змін/.test(claims(role)), role).toBe(can(role, "audit_log", "read"));
      // «Експорт усього» лише власнику.
      expect(/експорт усього/.test(claims(role)), role).toBe(can(role, "export_all", "write"));
    }
  });
});

describe("які пункти бачить користувач", () => {
  const production = SCREEN_HINTS.production;
  const terms = (access: { work?: boolean; edit?: boolean }) =>
    visibleHintItems(production, access).map((item) => item.term);

  it("власник і менеджер (лише дивляться) бачать лише загальні пункти", () => {
    expect(terms({})).toEqual(["Нове", "Оновлення і звук"]);
  });

  it("виробництво бачить «Розпочати» й «Готово», але не правки старшого локації", () => {
    expect(terms({ work: true })).toEqual(["Нове", "Розпочати", "Готово", "Оновлення і звук"]);
  });

  it("старший локації бачить усе", () => {
    expect(terms({ work: true, edit: true })).toHaveLength(production.items.length);
  });
});

describe("підказки стоять на своїх екранах", () => {
  it("статуси на списку замовлень, суми на готівці, довідка на виробництві, ролі у формі користувача", () => {
    expect(read("src/components/ordersPage/OrdersPageContent.tsx")).toContain(
      "SCREEN_HINTS.orderStatuses",
    );
    expect(read("src/components/cashPage/CashPageContent.tsx")).toContain("SCREEN_HINTS.cash");
    expect(read("src/components/usersPage/UserForm.tsx")).toContain("SCREEN_HINTS.roles");
  });

  it("на екрані виробництва підказка є в звичайному режимі й немає в режимі «на стіну»", () => {
    const source = read("src/components/productionPage/ProductionPageContent.tsx");
    expect(source.match(/<ScreenHint/g)).toHaveLength(1);
    const wallBranch = source.slice(
      source.indexOf("if (wall) {"),
      source.indexOf('return (\n    <div className="flex flex-col gap-5">'),
    );
    expect(wallBranch).not.toContain("ScreenHint");
    expect(source).toContain("access={{ work: canWork, edit: canEdit }}");
  });

  it("форма замовлення пояснює «Продано» і «Виготовити», історії мають пояснення, експорт каже, що потрапить у файл", () => {
    expect(read("src/components/ordersPage/OrderForm.tsx")).toContain("INLINE_HINTS.orderKg");
    expect(read("src/components/ordersPage/OrderCardContent.tsx")).toContain(
      "INLINE_HINTS.orderChangeHistory",
    );
    expect(read("src/components/clientsPage/ClientCardContent.tsx")).toContain(
      "INLINE_HINTS.clientHistory",
    );
    expect(read("src/components/ordersPage/OrdersPageContent.tsx")).toContain(
      "INLINE_HINTS.exportOrders",
    );
    expect(read("src/components/clientsPage/ClientsPageContent.tsx")).toContain(
      "INLINE_HINTS.exportClients",
    );
    expect(read("src/components/cashPage/CashPageContent.tsx")).toContain(
      "INLINE_HINTS.exportCash",
    );
  });
});

describe("компонент підказки: правила оформлення", () => {
  it("складений зі спільних цеглинок, шрифт від 16 px, кольори з токенів, без власної плавності", () => {
    for (const file of sourceFiles("src/components/shared/hint")) {
      const source = read(file);
      expect(source, file).toContain("Disclosure");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])text-(?:xs|sm)(?=[\s"'`])/);
      expect(source, file).not.toMatch(/text-\[\d+(?:\.\d+)?px\]/);
      expect(source, file).not.toContain("overflow-x-auto");
      expect(source, file).not.toMatch(/(?:^|[\s"'`:])(?:duration|ease)-[\w[\].]+/);
      expect(source, file).not.toMatch(/from "@\/server\//);
    }
  });
});
