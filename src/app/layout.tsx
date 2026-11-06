import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM IceLab",
  description: "Облік клієнтів, замовлень, виробництва та оборотної тари IceLab",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <body className="antialiased">{children}</body>
    </html>
  );
}
