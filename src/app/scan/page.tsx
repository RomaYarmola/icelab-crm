import type { Metadata } from "next";
import BoxScanner from "@/components/boxesPage/BoxScanner";

export const metadata: Metadata = { title: "Сканер боксів" };

/** Нейтральна сторінка сканера: замовлення, скани й права приходять з API та IndexedDB телефона. */
export default function ScanPage() {
  return <BoxScanner />;
}
