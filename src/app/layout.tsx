import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/shared/pwa/ServiceWorkerRegistration";
import { APP_DESCRIPTION, APP_NAME } from "@/constants/constants";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // iPhone: відкриття з головного екрана без адресного рядка, підпис значка «IceLab».
  appleWebApp: { capable: true, title: "IceLab", statusBarStyle: "default" },
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
      <body className="font-system text-body text-navy antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
