// Початкові дані довідників (розділ 4.1 ТЗ).
//
// Усе, що позначено TODO, залежить від відповідей замовника на питання з розділу 14 ТЗ.
// Це лише дані: їх можна змінити в налаштуваннях або оновленням цього файлу, міграції не потрібні.

export const LOCATIONS = [
  { code: "kyiv", name: "Київ" },
  { code: "lviv", name: "Львів" },
];

export const ICE_TYPES = [
  { code: "3mm", name: "3 мм", sort: 1 },
  { code: "16mm", name: "16 мм", sort: 2 },
  { code: "19mm", name: "19 мм", sort: 3 },
];

export const ORDER_SOURCES = [
  { code: "site", name: "Сайт" },
  { code: "telegram", name: "Telegram" },
  { code: "instagram", name: "Instagram" },
  { code: "phone", name: "Телефон" },
  { code: "viber", name: "Viber" },
  { code: "whatsapp", name: "WhatsApp" },
  { code: "email", name: "E-mail" },
  { code: "repeat", name: "Повторне замовлення" },
  { code: "referral", name: "Рекомендація" },
  { code: "other", name: "Інше" },
];

export const CLIENT_STATUSES = [
  { code: "active", name: "Активний" },
  { code: "warm", name: "Підігрітий" },
  { code: "in_mind", name: "Має на увазі" },
  { code: "paused", name: "Пауза" },
];

// Назви з ТЗ, коди придумано для коду застосунку.
export const CLIENT_APPLICATIONS = [
  { code: "logistics", name: "Логістика" },
  { code: "heavy_smoke", name: "Важкий дим" },
  { code: "cleaning", name: "Чистка" },
  { code: "bar", name: "Бар" },
  { code: "kids_parties", name: "Дитячі свята" },
  { code: "freezing", name: "Заморозка" },
  { code: "other", name: "Інше" },
];

// TODO питання 2: повний список тари, місткість, вага порожнього бокса, що продається і за скільки.
// Нижче шість типів із ТЗ. Місткість лише там, де вона є в назві.
export const BOX_TYPES = [
  {
    code: "ours_long_46",
    name: "Наш довгий 46 л",
    volumeL: 46,
    capacityKg: null, // у ТЗ діапазон 25-30 кг, точне значення уточнити
    isReturnable: true,
    isClientOwned: false,
    sort: 1,
  },
  {
    code: "ours_small_19",
    name: "Наш малий 19 л",
    volumeL: 19,
    capacityKg: "10",
    isReturnable: true,
    isClientOwned: false,
    sort: 2,
  },
  {
    code: "mini_9",
    name: "mini 9 л",
    volumeL: 9,
    capacityKg: "5",
    isReturnable: true,
    isClientOwned: false,
    sort: 3,
  },
  {
    code: "white_50",
    name: "50 кг білий",
    volumeL: null,
    capacityKg: "50",
    isReturnable: true,
    isClientOwned: false,
    sort: 4,
  },
  {
    code: "box_60",
    name: "60 кг",
    volumeL: null,
    capacityKg: "60",
    isReturnable: true,
    isClientOwned: false,
    sort: 5,
  },
  {
    code: "client_box",
    name: "Бокс клієнта",
    volumeL: null,
    capacityKg: null,
    isReturnable: false,
    isClientOwned: true,
    sort: 6,
  },
];

// Значення налаштувань за замовчуванням (розділ 4.1 ТЗ). Налаштування Telegram
// (група, топіки, чат власника) заповнюємо в блоці B11.
export const SETTINGS = [
  { key: "markup.np_percent", value: 10 },
  { key: "markup.event_percent", value: 10 }, // TODO питання 3: 10 чи 15
  { key: "box.reminder_days", value: 14 },
  { key: "client.inactive_days_default", value: 30 },
  { key: "payment.amount_tolerance_uah", value: 5 },
  { key: "payment.date_window_days", value: 14 },
  { key: "np.default_payer", value: "Recipient" }, // TODO питання 7
  { key: "report.daily_time", value: "21:00" },
];
