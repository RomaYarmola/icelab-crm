import { requirePageUser } from "@/server/page-access";

/** Захист екрана «Прийом заявок»: лише власник, інші переходять на свою початкову сторінку. */
export default async function IntakeLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("intake");
  return children;
}
