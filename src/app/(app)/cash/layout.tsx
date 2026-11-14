import { requirePageUser } from "@/server/page-access";

/**
 * Захист екрана «Готівка»: власник, менеджер, бухгалтер і старший локації, інші (виробництво, водій)
 * переходять на свою початкову сторінку. Перевірка в layout, щоб відбуватись до відповіді. Права
 * на запис і сторно перевіряє `server/cash.ts` окремо.
 */
export default async function CashLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("cash");
  return children;
}
