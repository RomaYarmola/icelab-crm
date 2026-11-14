import { ORDER_STATUS_LABELS } from "@/constants/constants";
import { ADDRESS_KIND_LABELS, LEGAL_TYPE_LABELS } from "@/constants/clients";
import {
  BOX_OWNERSHIP_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_KIND_LABELS,
} from "@/constants/orders";
import { BOX_STATUS_LABELS } from "./box-rules";
import { ROLE_LABELS } from "./permissions";

/**
 * Словник журналу змін (B8, D90): як таблиці, поля й значення називаються людською мовою. Журнал
 * пише база (колонки `snake_case`, значення як у базі), а власник читає «Кількість на продаж:
 * 30 → 35 кг». Тест `audit-labels.test.ts` вимагає підпис для кожної колонки кожної таблиці, що
 * пише журнал: нова таблиця (B9–B13) без підписів не пройде CI.
 */

export const AUDIT_SECTIONS = {
  orders: "Замовлення",
  clients: "Клієнти",
  cash: "Готівка",
  prices: "Прайс",
  users: "Користувачі",
  settings: "Налаштування",
  exports: "Експорт",
  boxes: "Бокси",
} as const;

export type AuditSection = keyof typeof AUDIT_SECTIONS;

export const AUDIT_SECTION_ORDER = Object.keys(AUDIT_SECTIONS) as AuditSection[];

/** На що посилається ідентифікатор у значенні (для підстановки назви замість uuid). */
export type AuditRef =
  | "client"
  | "location"
  | "iceType"
  | "source"
  | "boxType"
  | "address"
  | "user"
  | "application"
  | "clientStatus"
  | "order";

export type AuditField =
  | {
      label: string;
      kind:
        | "text"
        | "number"
        | "kg"
        | "money"
        | "moneyPerKg"
        | "percent"
        | "bool"
        | "date"
        | "timestamp"
        | "json"
        /** Фільтри експорту: плоский об'єкт читається як «Ключ: значення; Ключ: значення». */
        | "filters";
    }
  | { label: string; kind: "enum"; values: Record<string, string> }
  | { label: string; kind: "ref"; ref: AuditRef }
  /** Службове поле: у журналі не показуємо (ідентифікатори, автор і час запису, технічні посилання). */
  | { label: string; kind: "hidden" };

export type AuditTable = {
  /** Як називається запис («Замовлення», «Позиція замовлення»). */
  label: string;
  section: AuditSection;
  /** Що створили чи змінили, у знахідному відмінку: «Створено замовлення». */
  noun: string;
  fields: Record<string, AuditField>;
};

const hidden = (label: string): AuditField => ({ label, kind: "hidden" });
const text = (label: string): AuditField => ({ label, kind: "text" });
const number = (label: string): AuditField => ({ label, kind: "number" });
const kg = (label: string): AuditField => ({ label, kind: "kg" });
const money = (label: string): AuditField => ({ label, kind: "money" });
const moneyPerKg = (label: string): AuditField => ({ label, kind: "moneyPerKg" });
const bool = (label: string): AuditField => ({ label, kind: "bool" });
const date = (label: string): AuditField => ({ label, kind: "date" });
const timestamp = (label: string): AuditField => ({ label, kind: "timestamp" });
const ref = (label: string, target: AuditRef): AuditField => ({ label, kind: "ref", ref: target });
const choice = (label: string, values: Record<string, string>): AuditField => ({
  label,
  kind: "enum",
  values,
});

const SYSTEM_FIELDS = {
  created_at: hidden("Створено"),
  updated_at: hidden("Змінено"),
};

export const ITEM_KIND_LABELS = {
  ice: "Лід",
  delivery: "Доставка",
  box_sale: "Продаж боксу",
  other: "Інше",
};

export const ENTERED_VIA_LABELS = { web: "веб", driver_bot: "бот водія" };

export const BOX_EVENT_LABELS = {
  created: "створено",
  label_printed: "наклейку надруковано",
  issued: "видано",
  returned: "повернено",
  sold: "продано",
  lost: "втрачено",
  found: "знайдено",
  transferred: "переміщено",
  note: "примітка",
};

export const EXPORT_KIND_LABELS = {
  orders: "Замовлення",
  clients: "Клієнти",
  cash: "Готівка",
  all: "Усі дані",
};

export const AUDIT_TABLES: Record<string, AuditTable> = {
  orders: {
    label: "Замовлення",
    section: "orders",
    noun: "замовлення",
    fields: {
      id: hidden("Ідентифікатор"),
      number: number("Номер"),
      location_id: ref("Локація", "location"),
      client_id: ref("Клієнт", "client"),
      status: choice("Статус", ORDER_STATUS_LABELS),
      source_id: ref("Джерело", "source"),
      order_date: date("Дата виконання"),
      ice_type_id: ref("Тип льоду", "iceType"),
      kg_sold: kg("Кількість на продаж"),
      kg_to_produce: kg("Виготовити"),
      markup_percent_applied: { label: "Надбавка", kind: "percent" },
      price_per_kg_snapshot: moneyPerKg("Ціна за кг"),
      price_manual: bool("Ціну вказано вручну"),
      delivery_method: choice("Спосіб доставки", DELIVERY_METHOD_LABELS),
      address_id: ref("Адреса", "address"),
      delivery_text: text("Доставка (текст)"),
      time_window: text("Вікно часу"),
      recipient_name: text("Отримувач"),
      recipient_phone: text("Телефон отримувача"),
      box_type_id: ref("Тип тари", "boxType"),
      box_count: number("Кількість тари"),
      box_ownership: choice("Чия тара", BOX_OWNERSHIP_LABELS),
      comment: text("Коментар для виробництва"),
      internal_comment: text("Внутрішній коментар"),
      payment_kind: choice("Спосіб оплати", PAYMENT_KIND_LABELS),
      total: money("Сума замовлення"),
      confirmed_at: timestamp("Підтверджено"),
      confirmed_by: ref("Підтвердив", "user"),
      produced_at: timestamp("Виготовлено"),
      packed_at: timestamp("Запаковано"),
      shipped_at: timestamp("Відправлено"),
      paid_at: timestamp("Оплачено"),
      closed_at: timestamp("Закрито"),
      seen_by_production_at: timestamp("Цех побачив"),
      telegram_message_id: hidden("Повідомлення Telegram"),
      telegram_chat_id: hidden("Чат Telegram"),
      draft_payload: hidden("Дані розбору заявки"),
      duplicate_of: ref("Дубль замовлення", "order"),
      cancel_reason: text("Причина скасування"),
      is_archive: bool("Архівне"),
      deleted_at: timestamp("Видалено"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  order_items: {
    label: "Позиція замовлення",
    section: "orders",
    noun: "позицію замовлення",
    fields: {
      id: hidden("Ідентифікатор"),
      order_id: ref("Замовлення", "order"),
      kind: choice("Вид", ITEM_KIND_LABELS),
      title: text("Назва"),
      qty: number("Кількість"),
      unit: text("Одиниця"),
      price: money("Ціна"),
      amount: money("Сума"),
      box_type_id: ref("Тип тари", "boxType"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  order_price_changes: {
    label: "Зміна ціни замовлення",
    section: "orders",
    noun: "зміну ціни замовлення",
    fields: {
      id: hidden("Ідентифікатор"),
      order_id: ref("Замовлення", "order"),
      old_price: moneyPerKg("Стара ціна"),
      new_price: moneyPerKg("Нова ціна"),
      note: text("Причина"),
      changed_by: ref("Хто змінив", "user"),
      changed_at: hidden("Коли змінено"),
    },
  },
  cash_entries: {
    label: "Запис готівки",
    section: "cash",
    noun: "запис готівки",
    fields: {
      id: hidden("Ідентифікатор"),
      order_id: ref("Замовлення", "order"),
      location_id: ref("Локація", "location"),
      amount: money("Сума"),
      received_on: date("Дата прийому"),
      received_by_text: text("Хто прийняв"),
      entered_by: ref("Хто вніс", "user"),
      entered_via: choice("Звідки внесено", ENTERED_VIA_LABELS),
      note: text("Примітка"),
      reversed_at: timestamp("Сторновано"),
      reversed_by: ref("Хто сторнував", "user"),
      reversal_reason: text("Причина сторно"),
      ...SYSTEM_FIELDS,
    },
  },
  clients: {
    label: "Клієнт",
    section: "clients",
    noun: "клієнта",
    fields: {
      id: hidden("Ідентифікатор"),
      code: text("Код"),
      name: text("Назва"),
      legal_type: choice("Тип", LEGAL_TYPE_LABELS),
      edrpou: text("ЄДРПОУ"),
      ice_type_id: ref("Тип льоду", "iceType"),
      application_id: ref("Застосування", "application"),
      status_id: ref("Статус клієнта", "clientStatus"),
      manager_id: ref("Менеджер", "user"),
      source_id: ref("Джерело", "source"),
      default_box_type_id: ref("Тара за замовчуванням", "boxType"),
      markup_percent_override: { label: "Окрема надбавка", kind: "percent" },
      notes: text("Примітки"),
      inactive_days_threshold: number("Поріг «давно не замовляв», днів"),
      is_placeholder: bool("Заглушка"),
      deleted_at: timestamp("Видалено"),
      merged_into_id: ref("Об'єднано з", "client"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  client_prices: {
    label: "Ціна клієнта",
    section: "clients",
    noun: "ціну клієнта",
    fields: {
      id: hidden("Ідентифікатор"),
      client_id: ref("Клієнт", "client"),
      ice_type_id: ref("Тип льоду", "iceType"),
      price_per_kg: moneyPerKg("Ціна за кг"),
      min_kg: kg("Від, кг"),
      valid_from: date("Діє з"),
      valid_to: date("Діє до"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  client_contacts: {
    label: "Контакт клієнта",
    section: "clients",
    noun: "контакт клієнта",
    fields: {
      id: hidden("Ідентифікатор"),
      client_id: ref("Клієнт", "client"),
      name: text("Ім'я"),
      phone: text("Телефон"),
      role: text("Роль"),
      is_primary: bool("Основний"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  client_addresses: {
    label: "Адреса клієнта",
    section: "clients",
    noun: "адресу клієнта",
    fields: {
      id: hidden("Ідентифікатор"),
      client_id: ref("Клієнт", "client"),
      kind: choice("Вид", ADDRESS_KIND_LABELS),
      label: text("Назва"),
      city_text: text("Місто"),
      address_text: text("Адреса"),
      recipient_name: text("Отримувач"),
      np_city_ref: hidden("Місто Нової Пошти"),
      np_warehouse_ref: hidden("Відділення Нової Пошти"),
      np_warehouse_number: text("Відділення"),
      time_window: text("Вікно часу"),
      is_default: bool("Основна"),
      is_resolved: bool("Дані Нової Пошти звірено"),
      created_by: hidden("Автор"),
      ...SYSTEM_FIELDS,
    },
  },
  default_prices: {
    label: "Прайс",
    section: "prices",
    noun: "ціну прайсу",
    fields: {
      id: hidden("Ідентифікатор"),
      ice_type_id: ref("Тип льоду", "iceType"),
      min_kg: kg("Від, кг"),
      price_per_kg: moneyPerKg("Ціна за кг"),
      valid_from: date("Діє з"),
      valid_to: date("Діє до"),
      ...SYSTEM_FIELDS,
    },
  },
  profiles: {
    label: "Користувач",
    section: "users",
    noun: "користувача",
    fields: {
      id: hidden("Ідентифікатор"),
      full_name: text("Ім'я"),
      role: choice("Роль", ROLE_LABELS),
      location_id: ref("Локація", "location"),
      telegram_user_id: number("Telegram"),
      phone: text("Телефон"),
      is_active: bool("Активний"),
      ...SYSTEM_FIELDS,
    },
  },
  boxes: {
    label: "Бокс",
    section: "boxes",
    noun: "бокс",
    fields: {
      id: hidden("Ідентифікатор"),
      code: text("Код"),
      box_type_id: ref("Тип бокса", "boxType"),
      location_id: ref("Локація", "location"),
      status: choice("Статус", BOX_STATUS_LABELS),
      current_client_id: ref("Клієнт", "client"),
      current_order_id: ref("Замовлення", "order"),
      issued_at: timestamp("Видано"),
      label_printed_at: timestamp("Наклейку надруковано"),
      retired_at: timestamp("Списано"),
      retire_reason: text("Причина списання"),
      ...SYSTEM_FIELDS,
    },
  },
  box_events: {
    label: "Подія з боксом",
    section: "boxes",
    noun: "подію з боксом",
    fields: {
      id: hidden("Ідентифікатор"),
      box_id: hidden("Бокс"),
      event: choice("Подія", BOX_EVENT_LABELS),
      order_id: ref("Замовлення", "order"),
      client_id: ref("Клієнт", "client"),
      location_id: ref("Локація", "location"),
      actor_id: ref("Хто", "user"),
      occurred_at: timestamp("Коли відскановано"),
      recorded_at: timestamp("Коли записано"),
      device_queue_id: hidden("Номер скана"),
      note: text("Примітка"),
    },
  },
  box_debts_legacy: {
    label: "Старий борг по боксах",
    section: "boxes",
    noun: "старий борг по боксах",
    fields: {
      id: hidden("Ідентифікатор"),
      client_id: ref("Клієнт", "client"),
      box_type_id: ref("Тип бокса", "boxType"),
      count: number("Кількість"),
      since_date: date("З якого дня"),
      source_row: text("Звідки"),
      resolved_count: number("Закрито"),
      ...SYSTEM_FIELDS,
    },
  },
  exports: {
    label: "Експорт у Excel",
    section: "exports",
    noun: "експорт у Excel",
    fields: {
      id: hidden("Ідентифікатор"),
      kind: choice("Що вивантажено", EXPORT_KIND_LABELS),
      params: { label: "Фільтри", kind: "filters" },
      row_count: number("Рядків"),
      file_name: text("Файл"),
      file_url: hidden("Адреса файлу"),
      created_by: hidden("Хто вивантажив"),
      created_at: hidden("Створено"),
    },
  },
  settings: {
    label: "Налаштування",
    section: "settings",
    noun: "налаштування",
    fields: {
      key: text("Параметр"),
      value: { label: "Значення", kind: "json" },
      ...SYSTEM_FIELDS,
    },
  },
};

/** Таблиці розділу журналу. */
export function tablesOfSection(section: AuditSection): string[] {
  return Object.entries(AUDIT_TABLES)
    .filter(([, table]) => table.section === section)
    .map(([name]) => name);
}
