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
  /** Вага посилки, кг: лід плюс порожні бокси (D127), але не менше об'ємної ваги (D158). */
  weightKg: number;
  /** Вага визначена за об'ємом, бо вона більша за фактичну (D158). */
  byVolume: boolean;
  /** Скільки порожніх боксів уже враховано (для підказки на екрані). */
  emptyBoxesKg: number;
  seats: number;
  /** Чи відома вага порожнього бокса: якщо ні, додали типову (D166) і на екрані показуємо «орієнтовно». */
  emptyWeightKnown: boolean;
};

/** Скільки кг додаємо на бокс, коли вага порожнього бокса невідома (D166, Роман 20.11.2026). */
export const DEFAULT_EMPTY_BOX_KG = 1;

export type BoxDimensions = { heightMm: number; widthMm: number; lengthMm: number };

type BoxSpecSource = {
  emptyWeightKg: string | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
};

/**
 * Вага порожнього бокса й розміри: з бокса клієнта, якщо він обраний (D164), інакше з типу тари.
 * Кожне значення береться з бокса клієнта, коли воно там задане; розміри лише повним набором.
 */
export function boxSpec(
  own: BoxSpecSource | null,
  type: BoxSpecSource | null,
): { emptyWeightKg: string | null; dimensions: BoxDimensions | null } {
  const dims = (source: BoxSpecSource | null): BoxDimensions | null =>
    source?.heightMm && source.widthMm && source.lengthMm
      ? { heightMm: source.heightMm, widthMm: source.widthMm, lengthMm: source.lengthMm }
      : null;
  return {
    emptyWeightKg: own?.emptyWeightKg ?? type?.emptyWeightKg ?? null,
    dimensions: dims(own) ?? dims(type),
  };
}

/** Об'ємна вага одного бокса за формулою Нової Пошти: Д×Ш×В у см, поділене на 4000 (D158). */
export function volumetricWeightKg(dimensions: BoxDimensions): number {
  const cm3 = (dimensions.heightMm * dimensions.widthMm * dimensions.lengthMm) / 1000;
  return cm3 / 4000;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Вага й місця: лід + порожні бокси, кількість місць = кількість боксів (мінімум 1). Коли вага
 * порожнього бокса невідома, додаємо типову на кожен бокс (D166); коли відомі розміри, вага не
 * менша за об'ємну (D158).
 */
export function shipmentParams(input: {
  kgToProduce: string;
  boxCount: number;
  emptyWeightKg: string | null;
  /** Типова вага порожнього бокса, кг (налаштування `np.default_empty_box_kg`). */
  defaultEmptyKg?: number;
  dimensions?: BoxDimensions | null;
}): ShipmentParams {
  const ice = Number(input.kgToProduce) || 0;
  const emptyWeight = input.emptyWeightKg === null ? null : Number(input.emptyWeightKg);
  const emptyKnown = emptyWeight !== null && Number.isFinite(emptyWeight) && emptyWeight > 0;
  const boxes = Math.max(input.boxCount, 0);
  const perBox = emptyKnown ? emptyWeight! : (input.defaultEmptyKg ?? DEFAULT_EMPTY_BOX_KG);
  const emptyBoxesKg = round3(boxes * perBox);
  const actual = round3(ice + emptyBoxesKg);
  const volumetric =
    input.dimensions && boxes > 0 ? round3(boxes * volumetricWeightKg(input.dimensions)) : 0;
  return {
    weightKg: Math.max(actual, volumetric),
    byVolume: volumetric > actual,
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
