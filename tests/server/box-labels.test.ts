import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settings } from "@/db/schema";
import {
  boxUrl,
  buildLabelsPdf,
  DEFAULT_PUBLIC_URL,
  getPublicUrl,
  LABELS_PER_PAGE,
  PUBLIC_URL_KEY,
  qrMatrix,
} from "@/server/box-labels";
import { ValidationError } from "@/server/errors";
import { createTestDb, type TestDb } from "../db/harness";

const MM = 72 / 25.4;

/** Малює матрицю QR у пікселі (з білими полями) і читає її розпізнавачем: те, що побачить камера. */
function decode(matrix: boolean[][]): string | null {
  const scale = 8;
  const quiet = 4;
  const side = (matrix.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(data, side, side)?.data ?? null;
}

describe("наклейки на бокси (B9, D105, D111)", () => {
  it("QR читається назад: розпізнавач повертає адресу бокса", () => {
    for (const code of ["K-0001", "L-0123", "K-12345"]) {
      const url = boxUrl("https://crm.example.com/", code);
      expect(url).toBe(`https://crm.example.com/b/${code}`);
      expect(decode(qrMatrix(url)), code).toBe(url);
    }
  });

  it("аркуш A4: 24 наклейки на сторінку, розмір A4, сторінок стільки, скільки треба", async () => {
    const codes = Array.from({ length: 30 }, (_, i) => `K-${String(i + 1).padStart(4, "0")}`);
    const pdf = await PDFDocument.load(
      await buildLabelsPdf({ codes, publicUrl: DEFAULT_PUBLIC_URL, format: "sheet_3x8" }),
    );
    expect(pdf.getPageCount()).toBe(Math.ceil(30 / LABELS_PER_PAGE.sheet_3x8));
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(210 * MM, 0);
    expect(height).toBeCloseTo(297 * MM, 0);
  });

  it("наклейка 100×100: одна сторінка на код, розмір 100 мм", async () => {
    const pdf = await PDFDocument.load(
      await buildLabelsPdf({
        codes: ["K-0001", "K-0002"],
        publicUrl: DEFAULT_PUBLIC_URL,
        format: "single_100",
      }),
    );
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(100 * MM, 0);
  });

  it("пробний аркуш не залежить від кодів: 24 клітинки або одна сторінка", async () => {
    const sheet = await PDFDocument.load(
      await buildLabelsPdf({
        codes: [],
        publicUrl: DEFAULT_PUBLIC_URL,
        format: "sheet_3x8",
        test: true,
      }),
    );
    expect(sheet.getPageCount()).toBe(1);
    const single = await PDFDocument.load(
      await buildLabelsPdf({
        codes: [],
        publicUrl: DEFAULT_PUBLIC_URL,
        format: "single_100",
        test: true,
      }),
    );
    expect(single.getPageCount()).toBe(1);
  });

  it("зсув калібрування змінює вміст, але обмежений; сміття замість зсуву ігнорується", async () => {
    const base = { codes: ["K-0001"], publicUrl: DEFAULT_PUBLIC_URL, format: "sheet_3x8" as const };
    const a = await buildLabelsPdf(base);
    const b = await buildLabelsPdf({ ...base, offsetXmm: 2, offsetYmm: -1.5 });
    const c = await buildLabelsPdf({ ...base, offsetXmm: 500 });
    const d = await buildLabelsPdf({ ...base, offsetXmm: 10 });
    const nan = await buildLabelsPdf({ ...base, offsetXmm: Number.NaN });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(c).length).toBe(Buffer.from(d).length);
    expect(Buffer.from(nan).length).toBe(Buffer.from(a).length);
  });

  it("некоректний код і порожній чи завеликий список відхиляються", async () => {
    const base = { publicUrl: DEFAULT_PUBLIC_URL, format: "sheet_3x8" as const };
    await expect(buildLabelsPdf({ ...base, codes: ["hello"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(buildLabelsPdf({ ...base, codes: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      buildLabelsPdf({ ...base, codes: Array.from({ length: 501 }, () => "K-0001") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe("публічна адреса з налаштувань", () => {
    let ctx: Awaited<ReturnType<typeof createTestDb>>;
    let db: TestDb;
    beforeAll(async () => {
      ctx = await createTestDb();
      db = ctx.db;
    });
    afterAll(async () => {
      await ctx.client.close();
    });

    it("без налаштування тимчасова адреса; задана береться без кінцевої косої; сміття ігнорується", async () => {
      expect(await getPublicUrl(db)).toBe(DEFAULT_PUBLIC_URL);
      await db.insert(settings).values({ key: PUBLIC_URL_KEY, value: "не адреса" });
      expect(await getPublicUrl(db)).toBe(DEFAULT_PUBLIC_URL);
      await db.update(settings).set({ value: "https://crm.icelab.com.ua/" });
      expect(await getPublicUrl(db)).toBe("https://crm.icelab.com.ua");
    });
  });
});
