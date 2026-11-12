/**
 * Генератор паролів для екранів власника («Згенерувати» при створенні користувача і зміні пароля):
 * щоб власнику не доводилось вигадувати пароль. Працює в браузері й на сервері (`crypto`).
 */

/** Без схожих символів (0/O, 1/l/I, i, o), щоб пароль можна було прочитати вголос чи перепечатати. */
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = LOWER + UPPER + DIGITS;

/** Довжина згенерованого пароля: понад 80 біт випадковості, але ще зручно диктувати. */
export const GENERATED_PASSWORD_LENGTH = 14;

/** Джерело випадкових байтів (у тестах підміняється, щоб перевірити алгоритм). */
export type RandomBytes = (length: number) => Uint8Array;

const secureRandomBytes: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/** Нескінченний потік випадкових байтів: джерело викликається порціями. */
function* byteStream(randomBytes: RandomBytes): Generator<number> {
  for (;;) yield* randomBytes(32);
}

/** Випадковий індекс 0..size-1 без перекосу: байти, що дали б нерівний розподіл, відкидаємо. */
function randomIndex(size: number, bytes: Generator<number>): number {
  const limit = Math.floor(256 / size) * size;
  for (;;) {
    const { value } = bytes.next();
    if (value < limit) return value % size;
  }
}

const hasAllClasses = (password: string) =>
  [LOWER, UPPER, DIGITS].every((set) => [...password].some((char) => set.includes(char)));

/**
 * Випадковий пароль з великих і малих літер та цифр, без схожих символів. Гарантує, що в ньому є
 * хоча б одна мала літера, велика літера і цифра (деякі системи цього вимагають).
 */
export function generatePassword(
  length = GENERATED_PASSWORD_LENGTH,
  randomBytes: RandomBytes = secureRandomBytes,
): string {
  const bytes = byteStream(randomBytes);
  for (;;) {
    let password = "";
    while (password.length < length) {
      password += ALPHABET[randomIndex(ALPHABET.length, bytes)];
    }
    if (hasAllClasses(password)) return password;
  }
}
