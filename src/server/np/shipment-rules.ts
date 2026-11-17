/**
 * Правила накладної Нової Пошти (B10, D127, D128, ТЗ 6.8 і 8.4). Чисті функції без бази й без
 * мережі: що потрібно для створення ТТН, яка вага й скільки місць, як розібрати ім'я і телефон
 * одержувача. Усе, що користувач побачить у списку «чого бракує», береться звідси.
 */

/** Статуси замовлення, у яких можна створити ТТН (D128): від «Підтверджено» до «Запаковано». */
export const SHIPMENT_ORDER_STATUSES = ["confirmed", "in_production", "packed"] as const;

export type ShipmentOrderInput = {
  status: string;
  deliveryMethod: string;
  recipientName: string | null;
  recipientPhone: string | null;
  kgToProduce: string;
  boxCount: number;
  total: string;
};

export type ShipmentAddressInput = {
  kind: string;
  isResolved: boolean;
  npCityRef: string | null;
  npWarehouseRef: string | null;
} | null;

export type ShipmentPrerequisites = {
  order: ShipmentOrderInput;
  address: ShipmentAddressInput;
  /** Відправник локації налаштований (контрагент, контактна особа, адреса, телефон, місто). */
  senderReady: boolean;
  /** Активна ТТН у замовлення вже є. */
  hasActiveShipment: boolean;
};

/** Список причин, чому ТТН створити ще не можна. Порожній список означає «можна». */
export function shipmentBlockers(input: ShipmentPrerequisites): string[] {
  const { order, address } = input;
  const blockers: string[] = [];
  if (order.deliveryMethod !== "np") blockers.push("Спосіб доставки не «Нова Пошта».");
  if (!(SHIPMENT_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    blockers.push("ТТН створюють для замовлення від «Підтверджено» до «Запаковано».");
  }
  if (input.hasActiveShipment) blockers.push("ТТН для цього замовлення вже є.");
  if (!address) {
    blockers.push("У замовленні немає адреси клієнта.");
  } else if (address.kind === "np_address") {
    // Доставка кур'єром за адресою потребує вулиці з довідника Нової Пошти: окремий крок, який
    // перевіряємо на справжньому ключі. Поки лише відділення.
    blockers.push(
      "Доставку за адресою поки не підтримуємо: оберіть склад Нової Пошти (відділення).",
    );
  } else if (address.kind !== "np_warehouse") {
    blockers.push("Адреса замовлення не належить Новій Пошті (склад Нової Пошти).");
  } else if (!address.isResolved || !address.npCityRef || !address.npWarehouseRef) {
    blockers.push("Адреса потребує уточнення: підберіть місто й відділення в довіднику.");
  }
  if (!normalizeNpPhone(order.recipientPhone)) {
    blockers.push("Вкажіть телефон одержувача у форматі +380.");
  }
  if (!input.senderReady) {
    blockers.push("Не налаштовано відправника для цієї локації (екран «Нова Пошта»).");
  }
  if (!(Number(order.kgToProduce) > 0)) blockers.push("Не вказано вагу замовлення.");
  if (!(Number(order.total) > 0))
    blockers.push("Сума замовлення нульова: оголошена вартість має бути більшою за 0.");
  return blockers;
}

/** Телефон для Нової Пошти: `380501234567` (без плюса). `null`, якщо формат не підходить. */
export function normalizeNpPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  return /^380\d{9}$/.test(digits) ? digits : null;
}

export type RecipientName = { lastName: string; firstName: string; middleName: string };

/**
 * Ім'я одержувача-особи за запитом Нової Пошти: прізвище, ім'я, по батькові. Очікуємо «Прізвище
 * Ім'я [По батькові]»; одного слова замало, бо Нова Пошта вимагає обидва.
 */
export function splitRecipientName(name: string | null | undefined): RecipientName | null {
  const words = (name ?? "")
    .replace(/[^\p{L}'’ʼ\- ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return null;
  return { lastName: words[0]!, firstName: words[1]!, middleName: words[2] ?? "" };
}

export type ShipmentParams = {
  /** Вага посилки, кг: лід плюс порожні бокси (D127). */
  weightKg: number;
  /** Скільки порожніх боксів уже враховано (для підказки на екрані). */
  emptyBoxesKg: number;
  seats: number;
  /** Чи відома вага порожнього бокса: якщо ні, на екрані показуємо застереження. */
  emptyWeightKnown: boolean;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Вага й місця: лід + порожні бокси, кількість місць = кількість боксів (мінімум 1). */
export function shipmentParams(input: {
  kgToProduce: string;
  boxCount: number;
  emptyWeightKg: string | null;
}): ShipmentParams {
  const ice = Number(input.kgToProduce) || 0;
  const emptyWeight = input.emptyWeightKg === null ? null : Number(input.emptyWeightKg);
  const emptyKnown = emptyWeight !== null && Number.isFinite(emptyWeight) && emptyWeight > 0;
  const boxes = Math.max(input.boxCount, 0);
  const emptyBoxesKg = emptyKnown ? round3(boxes * emptyWeight!) : 0;
  return {
    weightKg: round3(ice + emptyBoxesKg),
    emptyBoxesKg,
    seats: Math.max(boxes, 1),
    emptyWeightKnown: emptyKnown || boxes === 0,
  };
}

/** Дата для Нової Пошти `дд.мм.рррр`; ТТН не створюють заднім числом, тож не раніше за сьогодні. */
export function npDate(orderDate: string, today: string): string {
  const day = orderDate < today ? today : orderDate;
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

/** Послуга: від відділення до відділення (доставка за адресою додається після перевірки на ключі). */
export const NP_SERVICE_TYPE = "WarehouseWarehouse";
