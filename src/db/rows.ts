/**
 * Рядки з результату `db.execute(sql...)`. Драйвери віддають його по-різному: справжній
 * (postgres.js) масив рядків, тестовий (PGlite) об'єкт із полем `rows`. Тому читати результат
 * напряму не можна: тест на PGlite проходить, а на справжній базі код ламається.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
