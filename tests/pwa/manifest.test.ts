import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import nextConfig from "../../next.config";
import { config as proxyConfig } from "@/proxy";

/** Розмір PNG зі службового блока IHDR (байти 16-23). */
function pngSize(path: string) {
  const buffer = readFileSync(join(process.cwd(), path));
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("маніфест застосунку (PWA)", () => {
  const data = manifest();

  it("відкривається як окремий застосунок з головного екрана", () => {
    expect(data).toMatchObject({
      name: "IceLab CRM",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "uk",
      background_color: "#ffffff",
      theme_color: "#ffffff",
    });
  });

  it("має значки 192 і 512, а також значок «maskable» для Android", () => {
    const icons = data.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("кожен значок із маніфеста існує і має заявлений розмір", () => {
    for (const icon of data.icons ?? []) {
      const [width, height] = icon.sizes!.split("x").map(Number);
      expect(pngSize(join("public", icon.src))).toEqual({ width, height });
    }
  });

  it("значки для iPhone і вкладки браузера лежать у src/app (Next.js додає їх сам)", () => {
    expect(pngSize("src/app/apple-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("src/app/icon.png").width).toBeGreaterThanOrEqual(32);
  });
});

describe("файли застосунку не перекидаються на вхід", () => {
  // Правило matcher із src/proxy.ts як регулярний вираз.
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

  it("маніфест, service worker, сторінка «Немає зв'язку» і значки йдуть повз перевірку входу", () => {
    for (const path of [
      "/manifest.webmanifest",
      "/sw.js",
      "/offline.html",
      "/icons/icon-192.png",
      "/images/logo/mark.svg",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("сторінки застосунку, як і раніше, проходять перевірку входу", () => {
    for (const path of ["/", "/orders", "/more/users", "/api/health", "/login"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});

describe("заголовки service worker", () => {
  it("sw.js не кешується браузером і виконується лише зі свого сайту", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((item) => item.source === "/sw.js");
    const headers = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
    expect(headers["Cache-Control"]).toContain("no-cache");
    expect(headers["Cache-Control"]).toContain("must-revalidate");
    expect(headers["Content-Type"]).toContain("application/javascript");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'self'");
  });
});
