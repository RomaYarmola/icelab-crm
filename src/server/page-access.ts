import { redirect } from "next/navigation";
import type { NavItemId } from "@/constants/navigation";
import { canOpenPage, homePathFor } from "@/utils/navigation";
import { requireUser } from "./auth";
import type { AppUser } from "./guards";

/**
 * Користувач сторінки розділу. Якщо роль не має права на цей розділ (наприклад, виробництво
 * відкрило адресу `/orders`), переводить на її початкову сторінку. Меню таких розділів не
 * показує, а ця перевірка закриває прямий перехід за адресою. Дані розділу все одно
 * перевіряються на сервері окремо, тут лише навігація.
 */
export async function requirePageUser(pageId: NavItemId): Promise<AppUser> {
  const user = await requireUser();
  if (!canOpenPage(user.role, pageId)) redirect(homePathFor(user.role));
  return user;
}
