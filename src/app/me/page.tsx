import { redirect } from "next/navigation";

/** Стара технічна сторінка профілю. Профіль тепер у розділі «Ще», закладки лишаються робочими. */
export default function MeRedirect() {
  redirect("/more");
}
