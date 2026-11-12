/**
 * Код клієнта (D24, D42): дві великі кириличні літери області й номер («АА16», «ВС57») або лише
 * цифри для клієнта без області («21»). Код 404 зарезервований за клієнтом-заглушкою.
 * Чисті функції без бази: використовуються і сервером, і екранами.
 */

/**
 * Латинські літери, схожі на кириличні (D42). Менеджер може ввести «AA16» латинською, система
 * зведе це до «АА16» кирилицею. Літери, яких немає в позначках областей, не міняємо.
 */
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  I: "І",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
};

/** Ті самі літери, що в `clients_code_format` у базі. */
const LETTERS = "А-ЯІЇЄҐ";

const CODE_WITH_REGION = new RegExp(`^([${LETTERS}]{2})([0-9]+)$`);
const NUMERIC_CODE = /^[0-9]+$/;
const PLACEHOLDER_CODE = "404";
const REGION_PREFIX = new RegExp(`^[${LETTERS}]{2}$`);

/**
 * Приводить введений код до єдиного вигляду: великі літери, латинські двійники на кирилицю,
 * без пробілів, дефісів, крапок і підкреслень. Нічого не перевіряє: частковий ввід для пошуку
 * («аа1») теж проходить.
 */
export function normalizeClientCode(input: string): string {
  return [...input.toUpperCase()]
    .filter((char) => !/[\s\-._]/u.test(char))
    .map((char) => LATIN_TO_CYRILLIC[char] ?? char)
    .join("");
}

/** Чи це допустимий код клієнта (після нормалізації): літери й цифри або лише цифри, не 404. */
export function isValidClientCode(code: string): boolean {
  if (code === PLACEHOLDER_CODE) return false;
  return CODE_WITH_REGION.test(code) || NUMERIC_CODE.test(code);
}

export type ParsedClientCode = {
  /** Літери області або `null` для коду з самих цифр. */
  prefix: string | null;
  number: number;
};

/** Розбирає код на префікс і номер. Для недопустимого коду повертає `null`. */
export function parseClientCode(code: string): ParsedClientCode | null {
  if (!isValidClientCode(code)) return null;
  const withRegion = CODE_WITH_REGION.exec(code);
  if (withRegion) return { prefix: withRegion[1]!, number: Number(withRegion[2]) };
  return { prefix: null, number: Number(code) };
}

/** Чи рядок може бути префіксом області (дві великі кириличні літери). */
export function isRegionPrefix(value: string): boolean {
  return REGION_PREFIX.test(value);
}

/** Код із префікса й номера: `formatClientCode("АА", 16)` дає «АА16», без префікса «16». */
export function formatClientCode(prefix: string | null, number: number): string {
  return `${prefix ?? ""}${number}`;
}

/** Код, який зарезервований за клієнтом-заглушкою і не видається іншим клієнтам. */
export const PLACEHOLDER_CLIENT_CODE = PLACEHOLDER_CODE;
