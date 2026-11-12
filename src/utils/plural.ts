/**
 * Відмінювання слова за числом (українська): `1 тип`, `2 типи`, `5 типів`, `21 тип`, `11 типів`.
 * Форми: [для 1, для 2-4, для 5-20 і 0]. Чисті функції.
 */
export function pluralUk(count: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(Math.trunc(count));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
