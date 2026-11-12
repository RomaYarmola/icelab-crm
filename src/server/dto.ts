import type { orderItems, orders } from "@/db/schema";
import { can, isOwnLocationOnly, type UserRole } from "./permissions";

/**
 * Безпечне подання даних: з рядка бази лишаємо лише ті поля, які роль має право бачити.
 * Роль «Виробництво» ніколи не отримує ціни, суми, готівку й платежі (ТЗ, розділ 2.2).
 *
 * Правило проєкту: з сервера в браузер дані йдуть лише через такі функції, а не «рядок як є».
 * Подання будуємо за списком дозволених полів, тож нове поле в таблиці само не потрапить
 * у відповідь.
 */

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

/** Поля замовлення без грошей і оплати: їх бачать усі ролі, що мають доступ до замовлень. */
const ORDER_BASE_FIELDS = [
  "id",
  "number",
  "locationId",
  "clientId",
  "status",
  "sourceId",
  "orderDate",
  "iceTypeId",
  "kgSold",
  "kgToProduce",
  "markupPercentApplied",
  "deliveryMethod",
  "addressId",
  "deliveryText",
  "timeWindow",
  "recipientName",
  "recipientPhone",
  "boxTypeId",
  "boxCount",
  "boxOwnership",
  "comment",
  "confirmedAt",
  "producedAt",
  "packedAt",
  "shippedAt",
  "closedAt",
  "seenByProductionAt",
  "isArchive",
  "cancelReason",
  "duplicateOf",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof OrderRow)[];

const ORDER_MONEY_FIELDS = [
  "pricePerKgSnapshot",
  "priceManual",
  "total",
] as const satisfies readonly (keyof OrderRow)[];
const ORDER_PAYMENT_FIELDS = [
  "paymentKind",
  "paidAt",
] as const satisfies readonly (keyof OrderRow)[];

/** Внутрішній коментар бачать і міняють лише ті, хто веде замовлення (власник, менеджер). */
const ORDER_INTERNAL_FIELDS = ["internalComment"] as const satisfies readonly (keyof OrderRow)[];

// Службові поля (telegram*, draftPayload, confirmedBy, createdBy та інші) свідомо не входять у
// жодне подання: додамо, коли їх справді потребуватиме екран.

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = source[key];
  return result;
}

export type OrderView = Pick<OrderRow, (typeof ORDER_BASE_FIELDS)[number]> &
  Partial<Pick<OrderRow, (typeof ORDER_MONEY_FIELDS)[number]>> &
  Partial<Pick<OrderRow, (typeof ORDER_PAYMENT_FIELDS)[number]>> &
  Partial<Pick<OrderRow, (typeof ORDER_INTERNAL_FIELDS)[number]>>;

/**
 * Замовлення для відповіді сервера.
 * Ціна й сума: ролі з правом «замовлення: суми й ціни» (власник, менеджер, бухгалтер).
 * Спосіб і дата оплати: ті, хто бачить суми або готівку (старший локації веде готівку своєї
 * локації, тому спосіб оплати йому потрібен).
 */
export function toOrderView(order: OrderRow, role: UserRole): OrderView {
  const view: OrderView = pick(order, ORDER_BASE_FIELDS);
  if (can(role, "order_money", "read")) Object.assign(view, pick(order, ORDER_MONEY_FIELDS));
  if (can(role, "order_money", "read") || can(role, "order_cash", "read")) {
    Object.assign(view, pick(order, ORDER_PAYMENT_FIELDS));
  }
  if (can(role, "orders", "write") && !isOwnLocationOnly(role, "orders")) {
    Object.assign(view, pick(order, ORDER_INTERNAL_FIELDS));
  }
  return view;
}

const ORDER_ITEM_BASE_FIELDS = [
  "id",
  "orderId",
  "kind",
  "title",
  "qty",
  "unit",
  "boxTypeId",
] as const satisfies readonly (keyof OrderItemRow)[];

export type OrderItemView = Pick<OrderItemRow, (typeof ORDER_ITEM_BASE_FIELDS)[number]> &
  Partial<Pick<OrderItemRow, "price" | "amount">>;

/** Позиція замовлення: ціна й сума лише для ролей з правом на суми. */
export function toOrderItemView(item: OrderItemRow, role: UserRole): OrderItemView {
  const view: OrderItemView = pick(item, ORDER_ITEM_BASE_FIELDS);
  if (can(role, "order_money", "read")) Object.assign(view, pick(item, ["price", "amount"]));
  return view;
}

// ---------------------------------------------------------------------------------------------
// Перевірка готової відповіді: чи не потрапили в неї заборонені поля.
// Для автотестів відповідей API (B5, B6): `expect(findForbiddenFields(body, role)).toEqual([])`.
// ---------------------------------------------------------------------------------------------

/** Приводить назву поля до єдиного вигляду: `price_per_kg` і `pricePerKg` дають `priceperkg`. */
const normalizeKey = (key: string) => key.replaceAll("_", "").toLowerCase();
const normalize = (keys: string[]) => keys.map(normalizeKey);

/** Ціни й суми: потрібне право «замовлення: суми й ціни». */
const MONEY_KEYS = normalize([
  "price",
  "pricePerKg",
  "pricePerKgSnapshot",
  "salePrice",
  "amount",
  "total",
  "totalAmount",
]);
/** Ціни клієнтів і історія цін: потрібне право читати `client_prices`. */
const CLIENT_PRICE_KEYS = normalize(["prices", "clientPrices", "priceHistory", "currentPrices"]);
/** Прайс (ціни за замовчуванням): потрібне право читати `default_prices`. */
const DEFAULT_PRICE_KEYS = normalize(["defaultPrices", "priceList"]);
/** Готівка: потрібне право на готівку по замовленню. */
const CASH_KEYS = normalize(["cash", "cashAmount", "cashEntries"]);
/** Безготівка й зіставлення платежів: потрібне право на банківські платежі. */
const BANK_KEYS = normalize(["payments", "paymentMatches"]);
/** Спосіб і дата оплати: потрібне право на суми або на готівку. */
const PAYMENT_STATE_KEYS = normalize(["paymentKind", "paidAt"]);

/** Назви полів (у нормалізованому вигляді), яких роль не має бачити у відповідях. */
export function forbiddenKeysFor(role: UserRole): Set<string> {
  const hasMoney = can(role, "order_money", "read");
  const hasCash = can(role, "order_cash", "read");
  const forbidden = new Set<string>();
  if (!hasMoney) for (const key of MONEY_KEYS) forbidden.add(key);
  if (!hasCash) for (const key of CASH_KEYS) forbidden.add(key);
  if (!can(role, "bank_payments", "read")) for (const key of BANK_KEYS) forbidden.add(key);
  // Ціни клієнтів і прайс (B4): ціна за кг у відповіді про клієнта теж ціна.
  if (!can(role, "client_prices", "read")) {
    for (const key of CLIENT_PRICE_KEYS) forbidden.add(key);
    forbidden.add(normalizeKey("pricePerKg"));
  }
  if (!can(role, "default_prices", "read")) {
    for (const key of DEFAULT_PRICE_KEYS) forbidden.add(key);
    forbidden.add(normalizeKey("pricePerKg"));
  }
  if (!hasMoney && !hasCash) for (const key of PAYMENT_STATE_KEYS) forbidden.add(key);
  return forbidden;
}

/**
 * Шукає у відповіді (будь-якої вкладеності) поля, заборонені для ролі. Повертає шляхи знайдених
 * полів, наприклад `items[0].price`. Порожній масив означає, що все гаразд.
 */
export function findForbiddenFields(value: unknown, role: UserRole): string[] {
  const forbidden = forbiddenKeysFor(role);
  const found: string[] = [];

  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (node !== null && typeof node === "object" && !(node instanceof Date)) {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (forbidden.has(normalizeKey(key))) found.push(childPath);
        walk(child, childPath);
      }
    }
  };

  walk(value, "");
  return found;
}
