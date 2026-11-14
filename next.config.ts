import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Екрани «Готівка», «Прайс», «Журнал змін», «Експорт даних» і «Користувачі» самостійні, а не
    // частина «Ще». Старі закладки й посилання ведуть на нові адреси.
    return [
      ...["cash", "prices", "audit", "export", "users"].map((name) => ({
        source: `/more/${name}/:path*`,
        destination: `/${name}/:path*`,
        permanent: true,
      })),
      // Профіль живе на `/profile` (раніше `/more`).
      { source: "/more", destination: "/profile", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Service worker не кешуємо, щоб оновлення доходили до телефонів одразу, і дозволяємо
        // лише скрипти зі свого сайту.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
