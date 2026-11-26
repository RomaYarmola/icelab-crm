import { userRole } from "@/db/schema/enums";

/**
 * Матриця прав з ТЗ (розділ 2.2) у вигляді даних. Єдине місце, де записано, хто що може.
 * Тест `tests/server/permissions.test.ts` звіряє кожну клітинку з таблицею ТЗ.
 *
 * Роль і локацію користувача беремо з таблиці `profiles` (рішення D18), а не з токена.
 */

export type UserRole = (typeof userRole.enumValues)[number];
export const USER_ROLES: readonly UserRole[] = userRole.enumValues;

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Власник",
  manager: "Менеджер",
  location_lead: "Старший локації",
  production: "Виробництво",
  accountant: "Бухгалтер",
  driver: "Водій",
};

/** Назва ролі людини: менеджера з правами бухгалтера називаємо обома. */
export const roleLabelOf = (user: { role: UserRole; isBookkeeper?: boolean }): string =>
  user.role === "manager" && user.isBookkeeper
    ? `${ROLE_LABELS.manager}, бухгалтер`
    : ROLE_LABELS[user.role];

/** Рядки матриці прав. */
export const RESOURCES = [
  "clients", // клієнти, адреси (без цін)
  "client_prices", // ціни клієнта, історія
  "default_prices", // прайс: ціни за замовчуванням (не з ТЗ, рішення D44)
  "reference_data", // довідники: типи льоду, тари, статуси, джерела, правила надбавки
  "orders", // замовлення: створення, правка до «у виробництві»
  "order_money", // замовлення: суми й ціни
  "order_price_override", // зміна ціни підтвердженого замовлення (не з ТЗ, рішення D52)
  "production_screen", // екран виробництва
  "order_ready_status", // статус «готово/запаковано»
  "order_cash", // готівка по замовленню
  "cash_reversal", // сторно запису готівки (не з ТЗ, рішення D69)
  "bank_payments", // безготівка, виписка, зіставлення
  "box_scan", // бокси: скан видачі й повернення
  "box_writeoff", // бокси: списання загубленого
  "box_debts_stock", // бокси: борги, склад
  "shipments", // ТТН: створення, стікери
  "bot_drafts", // чернетки з бота: підтвердження
  "analytics", // аналітика
  "finance", // фінансовий результат (B15)
  "excel_export", // експорт в Excel
  "export_all", // «Експорт усього»: уся база одним файлом (не з ТЗ, рішення D94)
  "users", // користувачі й ролі
  "audit_log", // журнал змін
  "migration_settings", // міграція, налаштування інтеграцій
] as const;
export type Resource = (typeof RESOURCES)[number];

export type AccessKind = "read" | "write";

type Access = {
  read?: true;
  write?: true;
  /** «св.» у ТЗ: лише записи своєї локації. */
  ownLocation?: true;
  /** Водій записує готівку лише через Telegram-бота, не через веб. */
  viaBotOnly?: true;
};

const R: Access = { read: true };
const W: Access = { write: true };
const RW: Access = { read: true, write: true };
const RW_OWN: Access = { read: true, write: true, ownLocation: true };
const R_OWN: Access = { read: true, ownLocation: true };
const W_OWN: Access = { write: true, ownLocation: true };

const MATRIX: Record<Resource, Partial<Record<UserRole, Access>>> = {
  clients: { owner: RW, manager: RW, location_lead: R, accountant: R },
  client_prices: { owner: RW, manager: RW, accountant: R },
  // D44: прайс змінює лише власник, менеджер і бухгалтер дивляться, старший локації цін не бачить.
  default_prices: { owner: RW, manager: R, accountant: R },
  reference_data: { owner: RW, manager: R, location_lead: R, production: R, accountant: R },
  orders: { owner: RW, manager: RW, location_lead: RW_OWN, accountant: R },
  order_money: { owner: R, manager: R, accountant: R },
  // D52: після підтвердження ціну замовлення змінює лише власник, з приміткою.
  order_price_override: { owner: W },
  production_screen: { owner: R, manager: R, location_lead: RW_OWN, production: RW_OWN },
  order_ready_status: { owner: W, location_lead: W_OWN, production: W_OWN },
  order_cash: {
    owner: RW,
    manager: R,
    location_lead: RW_OWN,
    // D241: виробництво возить замовлення й вносить готівку лише в боті, у вебі її не бачить.
    production: { write: true, viaBotOnly: true, ownLocation: true },
    accountant: R,
    driver: { write: true, viaBotOnly: true },
  },
  // D69: помилковий запис готівки виправляє лише власник (сторно з причиною).
  cash_reversal: { owner: W },
  bank_payments: { owner: RW, accountant: RW },
  box_scan: { owner: W, location_lead: W_OWN, production: W_OWN },
  box_writeoff: { owner: W },
  box_debts_stock: {
    owner: R,
    manager: R,
    location_lead: R_OWN,
    production: R_OWN,
    accountant: R,
  },
  shipments: { owner: W, manager: W, location_lead: W_OWN },
  bot_drafts: { owner: W, manager: W },
  analytics: { owner: R, manager: R, accountant: R },
  // Роман (26.11.2026): фінансовий результат бачить лише власник.
  finance: { owner: RW },
  excel_export: { owner: W, manager: W, accountant: W },
  export_all: { owner: W },
  users: { owner: RW },
  // У ТЗ рядок «Користувачі, ролі, журнал змін»: власник Ч/З, бухгалтер лише журнал.
  // Журнал редагувати не можна нікому, тому власнику тут лише читання.
  audit_log: { owner: R, accountant: R },
  migration_settings: { owner: W },
};

/**
 * Кого перевіряємо: роль або користувач. Користувачем передаємо там, де важить позначка
 * «також бухгалтер» (D243): вона додає менеджеру права з `BOOKKEEPER_EXTRA`.
 */
export type Subject = UserRole | { role: UserRole; isBookkeeper?: boolean };

export const roleOf = (subject: Subject): UserRole =>
  typeof subject === "string" ? subject : subject.role;

/** Менеджер із позначкою «також бухгалтер». Для інших ролей позначка нічого не дає. */
export const isBookkeepingManager = (subject: Subject): boolean =>
  typeof subject !== "string" && subject.role === "manager" && subject.isBookkeeper === true;

/** Менеджер, якому аналітику показуємо лише за своїми клієнтами (D205); бухгалтер бачить усю. */
export const seesOwnClientsOnly = (subject: Subject): boolean =>
  roleOf(subject) === "manager" && !isBookkeepingManager(subject);

/** Що позначка «також бухгалтер» додає менеджеру понад його власні права. */
const BOOKKEEPER_EXTRA: Partial<Record<Resource, Access>> = {
  bank_payments: RW,
  audit_log: R,
};

/** Ролі, що возять замовлення й користуються командами водія в боті (D241). */
export const DELIVERY_ROLES: readonly UserRole[] = ["driver", "production", "location_lead"];

export const canDeliverOrders = (role: UserRole) => DELIVERY_ROLES.includes(role);

/** Чи дозволяє матриця роль для дії (локацію записів тут не перевіряємо). */
export function can(subject: Subject, resource: Resource, kind: AccessKind): boolean {
  if (MATRIX[resource][roleOf(subject)]?.[kind] === true) return true;
  return isBookkeepingManager(subject) && BOOKKEEPER_EXTRA[resource]?.[kind] === true;
}

/** «св.»: дозвіл діє лише для записів своєї локації. */
export function isOwnLocationOnly(role: UserRole, resource: Resource): boolean {
  return MATRIX[resource][role]?.ownLocation === true;
}

/** Дозвіл лише через Telegram-бота (водій і готівка). */
export function isBotOnly(role: UserRole, resource: Resource): boolean {
  return MATRIX[resource][role]?.viaBotOnly === true;
}

/** Вхід у веб-інтерфейс: водій працює лише через Telegram-бота. */
export function canUseWeb(role: UserRole): boolean {
  return role !== "driver";
}

/** Ролі, для яких локація обов'язкова (так само, як CHECK у таблиці profiles). */
export const LOCATION_BOUND_ROLES: readonly UserRole[] = ["location_lead", "production", "driver"];

export function isLocationBound(role: UserRole): boolean {
  return LOCATION_BOUND_ROLES.includes(role);
}

/**
 * Правило локації з ТЗ: записи з `location_id` недоступні ролям з іншою локацією.
 * Користувач без локації (власник, менеджер, бухгалтер) бачить усі.
 */
export function canAccessLocation(
  user: { locationId: string | null },
  recordLocationId: string | null,
): boolean {
  if (user.locationId === null) return true;
  return recordLocationId === user.locationId;
}
