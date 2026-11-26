/**
 * Скільки таблиць і власних тригерів має бути в схемі `public` після всіх міграцій. Читає
 * `db:smoke`, а тест `tests/db/schema.test.ts` звіряє ці числа з міграціями: нова таблиця чи тригер
 * без оновлення тут не пройде CI.
 */
export const EXPECTED_TABLES = 53;
export const EXPECTED_TRIGGERS = 83;
