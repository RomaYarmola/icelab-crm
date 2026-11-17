/** Підписи Нової Пошти (B10): статуси накладної й платник. Без залежностей: потрібні й екранам. */

export const SHIPMENT_STATUS_LABELS = {
  draft: "Чернетка",
  created: "Створена",
  sent: "Відправлена",
  arrived: "У відділенні",
  received: "Отримана",
  returning: "Повертається",
  returned: "Повернена",
  refused: "Відмова одержувача",
  error: "Помилка",
} as const;

export type ShipmentStatus = keyof typeof SHIPMENT_STATUS_LABELS;

export const NP_PAYER_LABELS = {
  Sender: "Відправник",
  Recipient: "Одержувач",
} as const;

/** Скільки викликів Нової Пошти й коли очищаємо журнал викликів: 90 днів (ТЗ §8.7). */
export const INTEGRATION_LOG_RETENTION_DAYS = 90;
