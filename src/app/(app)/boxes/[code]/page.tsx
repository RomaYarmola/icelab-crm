import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BoxCardContent from "@/components/boxesPage/BoxCardContent";
import { getDb } from "@/db/client";
import { getBoxByCode } from "@/server/boxes";
import { requirePageUser } from "@/server/page-access";

export const metadata: Metadata = { title: "Бокс" };

/** Картка бокса з історією. Для ролей без реєстру ведемо в розділ «Бокси». */
export default async function BoxPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requirePageUser("boxes");
  const { code } = await params;
  const box = await getBoxByCode(getDb(), user, decodeURIComponent(code)).catch(() =>
    redirect("/boxes"),
  );
  if (!box) notFound();
  return (
    <BoxCardContent box={box} canPrint={user.role === "owner" || user.role === "location_lead"} />
  );
}
