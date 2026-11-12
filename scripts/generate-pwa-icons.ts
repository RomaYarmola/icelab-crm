import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

/**
 * Значки застосунку (PWA) із знака IceLab `public/images/logo/mark.svg`: кристал на білому тлі.
 * Запуск: `npx tsx scripts/generate-pwa-icons.ts` (потрібен лише після зміни логотипа).
 * Бібліотека `sharp` ставиться разом із Next.js, окремо її встановлювати не треба.
 *
 * - `any`: звичайні значки 192 і 512 (Android, Chrome);
 * - `maskable`: значок для Android, який система обрізає за формою (круг, «краплина»): знак
 *   менший, щоб лишитись у безпечній зоні (центральні 80%);
 * - `apple-icon`: значок на головний екран iPhone (iOS сам закруглює кути, прозорість заливає
 *   чорним, тому тло суцільне біле);
 * - `icon`: значок вкладки браузера.
 */

const BACKGROUND = "#ffffff";
const LOGO = "public/images/logo/mark.svg";

const targets = [
  { file: "public/icons/icon-192.png", size: 192, markRatio: 0.66 },
  { file: "public/icons/icon-512.png", size: 512, markRatio: 0.66 },
  { file: "public/icons/icon-maskable-512.png", size: 512, markRatio: 0.5 },
  { file: "src/app/apple-icon.png", size: 180, markRatio: 0.66 },
  { file: "src/app/icon.png", size: 256, markRatio: 0.78 },
] as const;

async function render(size: number, markRatio: number): Promise<Buffer> {
  const markSize = Math.round(size * markRatio);
  // Велика щільність при читанні SVG, щоб лінії лишились чіткими після зменшення.
  const mark = await sharp(readFileSync(LOGO), { density: 600 })
    .resize(markSize, markSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  for (const { file, size, markRatio } of targets) {
    mkdirSync(dirname(file), { recursive: true });
    await sharp(await render(size, markRatio)).toFile(file);
    console.log(`${file}: ${size}x${size}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
