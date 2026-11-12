import { requirePageUser } from "@/server/page-access";

/**
 * Захист екрана «Прайс»: власник, менеджер і бухгалтер, інші переходять на свою початкову
 * сторінку. Перевірка в layout, щоб відбуватись до відповіді (код 307 замість 200). Права на
 * саму зміну прайсу перевіряє `server/prices.ts` окремо.
 */
export default async function PricesLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("prices");
  return children;
}
