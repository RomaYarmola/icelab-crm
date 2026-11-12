/**
 * Телефони (D47): зберігаємо у вигляді E.164 (`+380501234567`, так вимагає база), а вводити
 * можна як завгодно: `050 123 45 67`, `(050) 123-45-67`, `+38 050 123 45 67`, `380501234567`.
 * Чисті функції без бази.
 */

/** Довжина E.164 без плюса: від 8 до 15 цифр (так само, як `client_contacts_phone_e164` у базі). */
const E164_PATTERN = /^\+[0-9]{8,15}$/;

/**
 * Приводить введений телефон до E.164 або повертає `null`, якщо номер не вдалося розпізнати.
 * Українські номери без коду країни (`050…`, `50…`, `8050…`) доповнюються до `+380…`.
 * Номер без плюса, який не схожий на український, не вгадуємо: потрібен `+` або `00`.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  let result: string | null = null;
  if (hasPlus) {
    result = `+${digits}`;
  } else if (digits.startsWith("00")) {
    // Міжнародний префікс: 00380… означає +380…
    result = `+${digits.slice(2)}`;
  } else if (digits.length === 12 && digits.startsWith("380")) {
    result = `+${digits}`;
  } else if (digits.length === 11 && digits.startsWith("80")) {
    // 8 0XX XXX XX XX: старий міжміський префікс 8
    result = `+3${digits}`;
  } else if (digits.length === 10 && digits.startsWith("0")) {
    result = `+38${digits}`;
  } else if (digits.length === 9 && /^[1-9]/.test(digits)) {
    // 50 123 45 67: без нуля на початку
    result = `+380${digits}`;
  }

  return result !== null && E164_PATTERN.test(result) ? result : null;
}

/** Мінімальна кількість цифр для пошуку за телефоном (менше дає забагато збігів). */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/**
 * Цифри з пошукового запиту для пошуку частини номера. Повертає `null`, якщо запит не схожий на
 * телефон: цифр менше трьох або в запиті є літери (тоді це пошук за назвою чи кодом).
 */
export function phoneSearchDigits(query: string): string | null {
  if (/[\p{L}]/u.test(query)) return null;
  const digits = query.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}

/** Телефон для показу: `+380501234567` дає «+38 050 123 45 67». Чужі номери повертаємо як є. */
export function formatPhone(phone: string): string {
  const match = /^\+380([0-9]{2})([0-9]{3})([0-9]{2})([0-9]{2})$/.exec(phone);
  return match ? `+38 0${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}
