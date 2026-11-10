import { randomInt } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

/** Файл із паролями створених скриптом користувачів. У `.gitignore`, у репозиторій не потрапляє. */
export const PASSWORDS_FILE = ".dev-users.local";

// Без схожих символів (0/O, 1/l/I), щоб пароль можна було перепечатати з файлу.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Випадковий пароль завдовжки 16 символів (понад 90 біт випадковості). */
export function generatePassword(length = 16): string {
  let result = "";
  for (let i = 0; i < length; i++) result += ALPHABET[randomInt(ALPHABET.length)];
  return result;
}

/**
 * Дописує рядок «e-mail, роль, пароль» у локальний файл. Паролі в консоль не виводимо:
 * їх бачить лише той, хто відкриє файл.
 */
export function savePassword(entry: {
  email: string;
  role: string;
  password: string;
  env: string;
}) {
  if (!existsSync(PASSWORDS_FILE)) {
    writeFileSync(
      PASSWORDS_FILE,
      "# Паролі користувачів, створених скриптами. Файл не комітиться. Видаліть його, коли паролі більше не потрібні.\n" +
        "# середовище\te-mail\tроль\tпароль\n",
      { mode: 0o600 },
    );
  }
  appendFileSync(
    PASSWORDS_FILE,
    `${entry.env}\t${entry.email}\t${entry.role}\t${entry.password}\n`,
  );
}
