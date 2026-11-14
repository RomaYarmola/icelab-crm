import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { LABELS_PER_PAGE, type LabelFormat } from "@/constants/boxes";
import { settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { ValidationError } from "./errors";
import { parseBoxCode } from "./box-rules";

/**
 * Наклейки на бокси: PDF з QR-кодами (B9, D105, D111). Наклейка містить слово «IceLab», QR і код
 * латиницею, тож шрифти не вбудовуємо. QR веде на `<публічна адреса>/b/<код>`: адреса береться з
 * налаштувань і змінюється до першого справжнього друку.
 */

export {
  LABEL_FORMAT_NAMES,
  LABEL_FORMATS,
  LABELS_PER_PAGE,
  type LabelFormat,
} from "@/constants/boxes";

export const PUBLIC_URL_KEY = "app.public_url";
/** Тимчасова адреса, поки власник не задасть постійну (друк наприкінці, D105). */
export const DEFAULT_PUBLIC_URL = "https://icelab-crm.vercel.app";

export async function getPublicUrl(db: AnyPgDatabase): Promise<string> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, PUBLIC_URL_KEY))
    .limit(1);
  const value = typeof row?.value === "string" ? row.value.trim() : "";
  return (/^https?:\/\//.test(value) ? value : DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
}

export function boxUrl(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/b/${code}`;
}

const PT_PER_MM = 72 / 25.4;
const mm = (value: number) => value * PT_PER_MM;

const MAX_OFFSET_MM = 10;
const MAX_LABELS = 500;

/** Матриця QR: `true` темний модуль. */
export function qrMatrix(text: string): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => qr.modules.get(x, y) === 1),
  );
}

export type LabelsPdfInput = {
  codes: string[];
  publicUrl: string;
  format: LabelFormat;
  /** Зсув друку в мм (калібрування принтера): вправо й вниз. */
  offsetXmm?: number;
  offsetYmm?: number;
  /** Пробний аркуш: рамки наклейок і напис TEST замість справжніх кодів. */
  test?: boolean;
};

const clampOffset = (value: number | undefined) =>
  Math.min(MAX_OFFSET_MM, Math.max(-MAX_OFFSET_MM, Number.isFinite(value) ? (value ?? 0) : 0));

/** PDF з наклейками. Порядок кодів зберігається, лишок аркуша порожній. */
export async function buildLabelsPdf(input: LabelsPdfInput): Promise<Uint8Array> {
  const codes = input.test
    ? Array.from(
        { length: LABELS_PER_PAGE[input.format] },
        (_, i) => `TEST-${String(i + 1).padStart(4, "0")}`,
      )
    : input.codes.map((raw) => {
        const code = parseBoxCode(raw);
        if (!code) throw new ValidationError(`Некоректний код бокса: ${raw}.`);
        return code;
      });
  if (codes.length === 0 || codes.length > MAX_LABELS) {
    throw new ValidationError(`Кодів від 1 до ${MAX_LABELS}.`);
  }
  const dx = mm(clampOffset(input.offsetXmm));
  const dy = mm(clampOffset(input.offsetYmm));

  const pdf = await PDFDocument.create();
  pdf.setTitle("Наклейки IceLab");
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const grey = rgb(0.75, 0.75, 0.75);

  const drawQr = (
    page: ReturnType<typeof pdf.addPage>,
    text: string,
    left: number,
    bottom: number,
    size: number,
  ) => {
    const matrix = qrMatrix(text);
    const quiet = 2; // модулі білих полів навколо
    const cell = size / (matrix.length + quiet * 2);
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (!dark) return;
        page.drawRectangle({
          x: left + (x + quiet) * cell,
          y: bottom + size - (y + quiet + 1) * cell,
          width: cell + 0.2,
          height: cell + 0.2,
          color: black,
        });
      }),
    );
  };

  if (input.format === "single_100") {
    const side = mm(100);
    for (const code of codes) {
      const page = pdf.addPage([side, side]);
      if (input.test)
        page.drawRectangle({
          x: dx,
          y: dy,
          width: side,
          height: side,
          borderColor: grey,
          borderWidth: 0.5,
        });
      const title = bold.widthOfTextAtSize("IceLab", 16);
      page.drawText("IceLab", {
        x: dx + (side - title) / 2,
        y: dy + mm(91),
        size: 16,
        font: bold,
        color: black,
      });
      drawQr(page, boxUrl(input.publicUrl, code), dx + mm(18), dy + mm(24), mm(64));
      const width = bold.widthOfTextAtSize(code, 28);
      page.drawText(code, {
        x: dx + (side - width) / 2,
        y: dy + mm(10),
        size: 28,
        font: bold,
        color: black,
      });
    }
  } else {
    const pageW = mm(210);
    const pageH = mm(297);
    const cellW = mm(70);
    const cellH = mm(35);
    const top = (pageH - cellH * 8) / 2;
    for (let start = 0; start < codes.length; start += 24) {
      const page = pdf.addPage([pageW, pageH]);
      codes.slice(start, start + 24).forEach((code, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const left = dx + col * cellW;
        const bottom = dy + pageH - top - (row + 1) * cellH;
        if (input.test)
          page.drawRectangle({
            x: left,
            y: bottom,
            width: cellW,
            height: cellH,
            borderColor: grey,
            borderWidth: 0.5,
          });
        drawQr(page, boxUrl(input.publicUrl, code), left + mm(3), bottom + mm(3.5), mm(28));
        page.drawText("IceLab", {
          x: left + mm(34),
          y: bottom + mm(21),
          size: 13,
          font: bold,
          color: black,
        });
        page.drawText(code, {
          x: left + mm(34),
          y: bottom + mm(11),
          size: 15,
          font: bold,
          color: black,
        });
      });
    }
  }
  return pdf.save();
}
