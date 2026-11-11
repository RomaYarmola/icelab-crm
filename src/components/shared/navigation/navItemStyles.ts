import { cn } from "@/utils/cn";

/*
  Єдині стилі пунктів меню. Активний пункт скрізь міняє лише колір (без жирного шрифту). Нижня панель телефона (bar), список у попапі (popup) і бічна панель
  комп'ютера (side) беруть класи звідси, тож наведення й активний стан скрізь однакові. Нижня панель
  і попап до того ж мають спільний шрифт і кольори (`barTextClassName`): підписи там однакові.
*/

/**
 * Шрифт і кольори підписів нижньої панелі і попапа: токен `text-nav`. Активний пункт міняє лише
 * колір (синій), шрифт і його товщина ті самі, тож підпис не міняє ширину і не «стрибає».
 */
const barTextClassName = (isActive: boolean) =>
  cn("text-nav", isActive ? "text-blue" : "text-grey-text");

/** Пункт у вертикальному списку бічної панелі комп'ютера (повний розмір тексту, активний лише синій). */
export const sideItemClassName = (isActive = false) =>
  cn(
    "flex min-h-12 w-full items-center gap-3 rounded-field px-4 text-left text-body transition",
    isActive ? "bg-grey-light text-blue" : "text-navy lg:hover:bg-grey-light",
  );

/**
 * Пункт у списку попапа (меню «Ще», меню користувача, вибір локації): розмір і кольори як у нижній
 * панелі. На комп'ютері (від lg) нижньої панелі немає, там розмір як у бічній панелі.
 */
export const popupItemClassName = (isActive = false) =>
  cn(
    "flex min-h-12 w-full items-center gap-3 rounded-field px-4 text-left transition lg:text-body",
    barTextClassName(isActive),
    isActive ? "bg-grey-light" : "lg:hover:bg-grey-light",
  );

/**
 * Пункт нижньої панелі телефона: значок над підписом. Ширина пункта точно за його вмістом, а
 * вільне місце розподіляє `justify-evenly` списку, тому відступи між пунктами (і до країв, і до
 * короткого «Ще») однакові. Зона натискання розширена невидимим `after` на 10 px з боків (для «Ще»
 * це дає 44 px завширшки), без впливу на розкладку.
 */
export const barItemClassName = (isActive = false) =>
  cn(
    "relative flex min-h-16.5 flex-col items-center justify-center gap-1 transition after:absolute after:inset-y-0 after:-inset-x-2.5 active:scale-[98%]",
    barTextClassName(isActive),
  );
