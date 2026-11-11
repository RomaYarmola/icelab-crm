import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { homePathFor } from "@/utils/navigation";

/** Корінь застосунку: без входу веде на `/login`, після входу на сторінку за роллю (ТЗ §6.1). */
export default async function Home() {
  const user = await requireUser();
  redirect(homePathFor(user.role));
}
