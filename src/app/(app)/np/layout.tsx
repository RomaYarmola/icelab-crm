import { requirePageUser } from "@/server/page-access";

/** Захист екрана «Нова Пошта»: лише власник, інші переходять на свою початкову сторінку. */
export default async function NpLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("np");
  return children;
}
