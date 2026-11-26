import { NAV_ITEMS, type NavItem, type NavItemId } from "@/constants/navigation";
import { can, canUseWeb, roleOf, type Subject, type UserRole } from "@/server/permissions";

/**
 * Які розділи бачить роль і куди веде вхід (ТЗ §6.1). Права беремо з матриці `permissions.ts`,
 * тож меню не може показати те, чого немає в ТЗ. Чисті функції без доступу до бази.
 */

export type NavPlacement = "bar" | "side";

/** Порядок розділів у меню. «Ще» завжди останній. */
const SECTION_ORDER: readonly NavItemId[] = [
  "orders",
  "production",
  "payments",
  "clients",
  "boxes",
];

/** У нижній панелі телефона не більше чотирьох розділів і «Ще» (п'ять пунктів вміщаються в 360 px). */
const BAR_SECTION_LIMIT = 4;

const HOME_PATH_BY_ROLE: Record<UserRole, string> = {
  owner: NAV_ITEMS.orders.href,
  manager: NAV_ITEMS.orders.href,
  location_lead: NAV_ITEMS.production.href,
  production: NAV_ITEMS.production.href,
  accountant: NAV_ITEMS.payments.href,
  // Водій у веб не входить (рішення D21): вести його нікуди, повертаємо на вхід.
  driver: "/login",
};

function canSeeSection(subject: Subject, id: NavItemId): boolean {
  switch (id) {
    case "orders":
      return can(subject, "orders", "read");
    case "clients":
      return can(subject, "clients", "read");
    case "production":
      return can(subject, "production_screen", "read");
    case "payments":
      return can(subject, "bank_payments", "read");
    case "analytics":
      return can(subject, "analytics", "read");
    case "finance":
      return can(subject, "finance", "read");
    case "boxes":
      return can(subject, "box_scan", "write") || can(subject, "box_debts_stock", "read");
    case "cash":
      return can(subject, "order_cash", "read");
    case "prices":
      return can(subject, "default_prices", "read");
    case "audit":
      return can(subject, "audit_log", "read");
    case "export":
      return can(subject, "export_all", "write");
    case "users":
      return can(subject, "users", "read");
    case "np":
    case "intake":
      return can(subject, "migration_settings", "write");
    case "shipments":
      return can(subject, "shipments", "write");
    case "more":
      return true;
  }
}

/** Чи відкрита сторінка цього розділу (сама адреса або будь-яка вкладена, наприклад /users). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Куди переходить користувач після входу. */
export function homePathFor(role: UserRole): string {
  return HOME_PATH_BY_ROLE[role];
}

/** Чи може роль відкрити сторінку розділу. Водій не може нічого: він працює через бот. */
export function canOpenPage(subject: Subject, id: NavItemId): boolean {
  if (!canUseWeb(roleOf(subject))) return false;
  return canSeeSection(subject, id);
}

/**
 * Пункти меню для ролі. Порядок один для всіх екранів, орієнтир бічна панель комп'ютера (`side`):
 * розділи, потім «Прайс», «Журнал змін», «Експорт даних», «Користувачі». Нижня панель телефона
 * (`bar`) бере перші чотири розділи в тому ж порядку й «Ще»; решта розділів і ці екрани стоять у
 * «Ще» в тому ж порядку. «Готівка» стоїть перед «Клієнтами» (після «Оплат», а без них після
 * «Виробництва»).
 */
export function navItemsFor(subject: Subject, placement: NavPlacement): NavItem[] {
  if (!canUseWeb(roleOf(subject))) return [];

  const sections = SECTION_ORDER.filter((id) => canSeeSection(subject, id)) as NavItemId[];
  // «Готівка», потім «Накладні» (ТТН на день): обидва перед «Клієнтами».
  for (const id of ["cash", "shipments"] as const) {
    if (!canSeeSection(subject, id)) continue;
    const at = sections.indexOf("clients");
    sections.splice(at === -1 ? sections.length : at, 0, id);
  }
  if (placement === "side") return sections.map((id) => NAV_ITEMS[id]);

  return [...sections.slice(0, BAR_SECTION_LIMIT), "more" as const].map((id) => NAV_ITEMS[id]);
}

/**
 * Самостійні екрани («Готівка», «Прайс», «Журнал змін», «Експорт даних», «Користувачі»): не розділи
 * нижньої панелі, на телефоні їх відкриває меню «Ще», на комп'ютері бічна панель. Мають власні адреси
 * (`/cash`, `/prices`…), до профілю не належать.
 */
export function accountNavItemsFor(subject: Subject): NavItem[] {
  if (!canUseWeb(roleOf(subject))) return [];
  return (["analytics", "finance", "prices", "audit", "export", "users", "np", "intake"] as const)
    .filter((id) => canSeeSection(subject, id))
    .map((id) => NAV_ITEMS[id]);
}

/**
 * Екрани бічної панелі комп'ютера після розділів: «Прайс» і «Користувачі» лише власнику, «Журнал
 * змін» і «Експорт даних» тим, хто має на них право. На телефоні вони в меню «Ще»
 * (`accountNavItemsFor`). «Готівка» і «Прайс» менеджера та бухгалтера лишаються в меню профілю.
 */
export function sideExtraNavItemsFor(subject: Subject): NavItem[] {
  if (!canUseWeb(roleOf(subject))) return [];
  const ids = (
    ["analytics", "finance", "prices", "audit", "export", "users", "np", "intake"] as const
  ).filter((id) => id !== "prices" || roleOf(subject) === "owner");
  return ids.filter((id) => canSeeSection(subject, id)).map((id) => NAV_ITEMS[id]);
}

/** Розділи, які доступні ролі, але не вмістились у нижню панель телефона: вони в меню «Ще». */
export function extraNavItemsFor(subject: Subject): NavItem[] {
  const inBar = new Set(navItemsFor(subject, "bar").map((item) => item.id));
  return navItemsFor(subject, "side").filter((item) => !inBar.has(item.id));
}
