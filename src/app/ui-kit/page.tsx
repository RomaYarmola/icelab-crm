import type { Metadata } from "next";
import { notFound } from "next/navigation";
import UiKitContent from "@/components/uiKitPage/UiKitContent";

export const metadata: Metadata = { title: "Каталог компонентів", robots: { index: false } };

/** Каталог компонентів. Лише для розробки: у збірці сторінки немає. */
export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiKitContent />;
}
