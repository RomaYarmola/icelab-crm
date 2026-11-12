import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Охоронні перевірки єдиної системи оформлення (рішення D37): плавність і курсор живуть в
 * одному місці, `src/app/globals.css`. Якщо хтось пропише швидкість чи криву прямо в
 * компоненті, ефект перестане бути єдиним, і тест це покаже.
 */

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("єдина плавність", () => {
  it("швидкість і крива задані токенами в globals.css", () => {
    expect(css).toMatch(/--transition-duration:\s*300ms/);
    expect(css).toMatch(/--transition-easing:\s*ease-in-out/);
    expect(css).toMatch(/--default-transition-duration:\s*var\(--transition-duration\)/);
    expect(css).toMatch(/--default-transition-timing-function:\s*var\(--transition-easing\)/);
  });

  it("для тих, хто вимкнув анімації, плавність зводиться до нуля", () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*{\s*:root\s*{\s*--transition-duration:\s*0\.01ms/,
    );
  });

  it("компоненти не задають швидкість чи криву самі (duration-*, ease-*)", () => {
    const offenders = sourceFiles(join(ROOT, "src"))
      .filter((file) =>
        /(?:^|[\s"'`:])(?:duration|ease)-[\w[\].]+/.test(readFileSync(file, "utf8")),
      )
      .map((file) => file.replace(`${ROOT}/`, ""));
    expect(offenders).toEqual([]);
  });
});

describe("курсор і фокус", () => {
  it("кнопки, посилання й інші клікабельні елементи отримують курсор pointer", () => {
    for (const selector of [
      "a[href]",
      "button:not(:disabled)",
      '[role="button"]',
      "summary",
      "select:not(:disabled)",
    ]) {
      expect(css, selector).toContain(selector);
    }
    expect(css).toMatch(/cursor:\s*pointer/);
  });

  it("поле вводу в фокусі міняє колір власної рамки на акцентний, без додаткового контуру", () => {
    // Контур фокуса для полів вимкнено глобально, а рамку перефарбовує сам компонент поля.
    expect(css).toMatch(/textarea,\s*select\s*\):focus-visible\s*{\s*outline-color:\s*transparent/);
    const input = readFileSync(
      join(ROOT, "src/components/shared/customizedInput/fieldStyles.ts"),
      "utf8",
    );
    expect(input).toContain("focus:border-blue-focus");
  });

  it("у фокусі поле має ще й м'яку тінь з токена, а для помилки червону", () => {
    // Рамка і тінь мають один і той самий колір: токен --color-blue-focus.
    expect(css).toMatch(/--color-blue-focus:\s*rgb\(18 86 163/);
    expect(css).toMatch(/--shadow-focus:\s*0 0 0 3px var\(--color-blue-focus\)/);
    expect(css).toMatch(/--shadow-focus-error:\s*0 0 0 3px rgb\(179 38 30/);
    const input = readFileSync(
      join(ROOT, "src/components/shared/customizedInput/fieldStyles.ts"),
      "utf8",
    );
    expect(input).toContain("focus:shadow-focus");
    expect(input).toContain("focus:shadow-focus-error");
  });

  it("поле пароля має кнопку «показати / сховати» всередині поля", () => {
    const input = readFileSync(
      join(ROOT, "src/components/shared/customizedInput/CustomizedInput.tsx"),
      "utf8",
    );
    expect(input).toContain('type === "password"');
    expect(input).toContain("Показати пароль");
    expect(input).toContain("Сховати пароль");
    // Значки змінюються плавно (IconSwitch), а не стрибком.
    expect(input).toContain("IconSwitch");
  });

  it("нижнє меню: пункти за шириною вмісту, відступи між ними однакові (також до «Ще»)", () => {
    const styles = readFileSync(
      join(ROOT, "src/components/shared/navigation/navItemStyles.ts"),
      "utf8",
    );
    const bar = readFileSync(join(ROOT, "src/components/shared/navigation/BottomNav.tsx"), "utf8");
    // Рівні клітинки (flex-1) дають різні відступи між підписами різної довжини.
    expect(styles).not.toMatch(/barItemClassName[\s\S]*flex-1/);
    expect(bar).not.toContain("flex-1");
    expect(bar).toContain("justify-evenly");
    // Зона натискання розширена невидимим after, а не відступами, що ламають рівність.
    expect(styles).toContain("after:-inset-x-2.5");
  });

  it("попап: пункти мають той самий шрифт і кольори, що й нижнє меню", () => {
    const styles = readFileSync(
      join(ROOT, "src/components/shared/navigation/navItemStyles.ts"),
      "utf8",
    );
    // Один спільний вираз для розміру й кольорів, а не два окремі набори класів.
    expect(styles).toMatch(/const barTextClassName/);
    // Його викликають і нижня панель, і попап.
    expect(styles.match(/barTextClassName\(/g)?.length).toBeGreaterThanOrEqual(2);
    const popupItem = styles.match(/export const popupItemClassName[\s\S]*?\n {2}\);/)?.[0] ?? "";
    // Активний пункт міняє лише колір: жирного шрифту немає ні в нижній панелі, ні в попапі.
    const barText = styles.match(/const barTextClassName[\s\S]*?\);/)?.[0] ?? "";
    expect(barText).not.toContain("font-bold");
    expect(popupItem).not.toContain("font-bold");
    // І бічна панель комп'ютера теж: у навігації жирного шрифту немає.
    const sideItem = styles.match(/export const sideItemClassName[\s\S]*?\n {2}\);/)?.[0] ?? "";
    expect(sideItem).not.toContain("font-bold");
    // Власного розміру тексту (text-body) на телефоні немає, він лише від lg.
    expect(popupItem).not.toMatch(/(^|[\s"'`])text-body/);
    // «Вийти» в попапі теж бере стиль попапа, а не бічної панелі.
    const action = readFileSync(
      join(ROOT, "src/components/shared/navigation/NavAction.tsx"),
      "utf8",
    );
    expect(action).toContain('variant = "popup"');
  });

  it("на ширшому екрані (від sm) усі розділи в нижньому меню, а «Ще» зникає", () => {
    const bar = readFileSync(join(ROOT, "src/components/shared/navigation/BottomNav.tsx"), "utf8");
    expect(bar).toContain("hidden sm:flex");
    expect(bar).toContain("flex sm:hidden");
    // Профіль і вихід на ширшому екрані доступні з мітки користувача в шапці.
    const header = readFileSync(join(ROOT, "src/components/shared/header/Header.tsx"), "utf8");
    expect(header).toContain("hidden sm:block lg:hidden");
    const shell = readFileSync(join(ROOT, "src/components/shared/layout/AppShell.tsx"), "utf8");
    expect(shell).toContain("<UserMenu");
  });

  it("активний пункт нижнього меню позначає одна смужка, що плавно їде між пунктами", () => {
    const bar = readFileSync(join(ROOT, "src/components/shared/navigation/BottomNav.tsx"), "utf8");
    const hook = readFileSync(
      join(ROOT, "src/components/shared/navigation/useNavIndicator.ts"),
      "utf8",
    );
    expect(bar).toContain("useNavIndicator");
    // Смужка рухається тим самим єдиним ефектом плавності (клас transition), без своєї тривалості.
    expect(bar).toMatch(/pointer-events-none[^"]*\btransition\b/);
    // Перше положення без анімації, щоб смужка не в'їжджала під час завантаження.
    expect(hook).toContain('transitionDuration = "0s"');
    // Положення з getBoundingClientRect: offsetLeft округлює до цілих пікселів.
    expect(hook).toContain("getBoundingClientRect");
  });

  it("екран входу: логотип і напис по центру; попап вужчий, текст профілю на телефоні дрібніший", () => {
    const login = readFileSync(join(ROOT, "src/app/login/page.tsx"), "utf8");
    expect(login).toMatch(/flex flex-col items-center gap-3 text-center/);
    const popup = readFileSync(join(ROOT, "src/components/shared/popup/Popup.tsx"), "utf8");
    expect(popup).toContain("w-[min(11.25rem,");
    const more = readFileSync(join(ROOT, "src/components/shared/navigation/MoreMenu.tsx"), "utf8");
    expect(more).toContain("text-caption sm:text-body");
    expect(more).toContain("text-nav sm:text-body");
  });

  it("попап «Ще» ширший за типовий (210 px), щоб ім'я в профілі не обрізалось", () => {
    const bar = readFileSync(join(ROOT, "src/components/shared/navigation/BottomNav.tsx"), "utf8");
    expect(bar).toContain("w-[min(13.125rem,");
  });

  it("локація в шапці: вибір для ролей без локації, підпис без рамки для решти", () => {
    const shell = readFileSync(join(ROOT, "src/components/shared/layout/AppShell.tsx"), "utf8");
    expect(shell).toContain("locationFilter.isSelectable");
    expect(shell).toContain("<LocationSelect");
    expect(shell).toContain('<Tag variant="plain">');
    const header = readFileSync(join(ROOT, "src/components/shared/header/Header.tsx"), "utf8");
    expect(header).toContain("location: ReactNode");
    // Кнопка вибору має зону натискання від 44 px, хоча сама «пігулка» на телефоні компактна.
    const select = readFileSync(
      join(ROOT, "src/components/shared/header/LocationSelect.tsx"),
      "utf8",
    );
    expect(select).toContain("after:-inset-y-2");
    // Попап стає прямо під кнопкою (anchorRef), має типову ширину `Popup` (без власного w-)
    // і текст 16 px.
    expect(select).toContain("anchorRef={triggerRef}");
    expect(select).not.toMatch(/w-\[min\(/);
    expect(select).toContain('className="text-body"');
    const popup = readFileSync(join(ROOT, "src/components/shared/popup/Popup.tsx"), "utf8");
    expect(popup).toContain("anchorRef");
    expect(popup).toContain("ANCHOR_GAP");
    const userMenu = readFileSync(
      join(ROOT, "src/components/shared/navigation/UserMenu.tsx"),
      "utf8",
    );
    expect(userMenu).toContain("anchorRef={triggerRef}");
    // Попап мітки користувача на планшеті ширший: там текст профілю 16 px.
    expect(userMenu).toContain("w-[min(16rem,");
  });

  it("«Назад» на екранах: компонент BackLink зі значком, а не стрілка-символ у тексті", () => {
    const back = readFileSync(join(ROOT, "src/components/shared/links/BackLink.tsx"), "utf8");
    expect(back).toContain("ChevronIcon");
    // Висота від 44 px (вимога ТЗ) і наведення лише від lg.
    expect(back).toContain("min-h-11");
    expect(back).toContain("lg:hover:");
    for (const file of ["UsersPageContent.tsx", "NewUserContent.tsx", "UserDetailContent.tsx"]) {
      const source = readFileSync(join(ROOT, "src/components/usersPage", file), "utf8");
      expect(source, file).toContain("<BackLink");
      expect(source, file).not.toContain("←");
    }
  });

  it("пароль користувача власник не вигадує: «Згенерувати» при створенні й зміні пароля", () => {
    for (const file of ["UserForm.tsx", "ResetPasswordForm.tsx"]) {
      const source = readFileSync(join(ROOT, "src/components/usersPage", file), "utf8");
      expect(source, file).toContain("<GeneratePasswordField");
    }
    const field = readFileSync(
      join(ROOT, "src/components/shared/customizedInput/GeneratePasswordField.tsx"),
      "utf8",
    );
    expect(field).toContain("Згенерувати");
    expect(field).toContain("Скопіювати");
    // Згенерований пароль показується одразу: власник має його побачити й передати.
    expect(field).toContain("setIsVisible(true)");
  });

  it("«Вийти» лише в меню: на сторінці профілю кнопки виходу немає", () => {
    const profile = readFileSync(
      join(ROOT, "src/components/profilePage/ProfileContent.tsx"),
      "utf8",
    );
    // Ні дії виходу, ні форми з кнопкою (у коментарі про це слово згадується, тож за текст не перевіряємо).
    expect(profile).not.toContain("signOut");
    expect(profile).not.toContain("<form");
    const more = readFileSync(join(ROOT, "src/components/shared/navigation/MoreMenu.tsx"), "utf8");
    expect(more).toContain("Вийти");
  });

  it("модальне вікно не зсуває сторінку: місце під смугу прокрутки зарезервоване", () => {
    // Без scrollbar-gutter смуга зникає разом із прокруткою, і вміст стрибає на її ширину.
    expect(css).toMatch(/html\s*{\s*scrollbar-gutter:\s*stable/);
    expect(css).toMatch(/body:has\(dialog\[open\]\)\s*{\s*overflow:\s*hidden/);
  });

  it("фокус з'являється плавно: контур завжди є, але прозорий, при фокусі змінюється колір", () => {
    expect(css).toMatch(/outline:\s*2px solid transparent/);
    expect(css).toMatch(/outline-color/);
    expect(css).toMatch(/:focus-visible\s*{\s*outline-color:\s*var\(--color-blue\)/);
  });
});
