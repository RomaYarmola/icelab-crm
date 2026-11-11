/** Перша літера імені великою (для круглої мітки користувача). Порожнє ім'я дає «?». */
export function getInitial(fullName: string): string {
  const [first] = Array.from(fullName.trim());
  return first ? first.toLocaleUpperCase("uk-UA") : "?";
}
