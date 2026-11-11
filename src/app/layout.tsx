import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_DESCRIPTION, APP_NAME } from "@/constants/constants";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Контент заходить під вирізи екрана (iPhone), а відступи беруть з env(safe-area-inset-*).
  viewportFit: "cover",
  // Колір рядка стану в PWA збігається з білою шапкою (варіант В).
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <body className="font-system text-body text-navy antialiased">{children}</body>
    </html>
  );
}
