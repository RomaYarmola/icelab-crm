import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/constants/constants";

/**
 * Маніфест застосунку (PWA): за ним телефон додає CRM на головний екран як окремий застосунок
 * без адресного рядка. Значки лежать у `public/icons` (їх створює `scripts/generate-pwa-icons.ts`
 * зі знака IceLab). Білий колір рядка стану й тла збігається з білою шапкою (варіант В).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: "IceLab",
    description: APP_DESCRIPTION,
    lang: "uk",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
