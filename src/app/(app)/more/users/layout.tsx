import { requirePageUser } from "@/server/page-access";

/**
 * Захист екрана «Користувачі»: лише власник, інші переходять на свою початкову сторінку. Перевірка в
 * layout, щоб відбуватись до відповіді (код 307 замість 200). Права на самі дії перевіряє
 * `server/users.ts` окремо.
 */
export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("users");
  return children;
}
