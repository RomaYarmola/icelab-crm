import { requirePageUser } from "@/server/page-access";

/** Захист екрана «Фінрезультат»: лише власник. Права на дії перевіряє `server/finance` окремо. */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("finance");
  return children;
}
