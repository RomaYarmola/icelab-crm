/** Формати наклейок на бокси (B9, D111). */
export const LABEL_FORMATS = ["sheet_3x8", "single_100"] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

export const LABEL_FORMAT_NAMES: Record<LabelFormat, string> = {
  sheet_3x8: "Аркуш A4, 24 наклейки 70×35 мм",
  single_100: "Одна наклейка 100×100 мм",
};

/** Скільки наклейок на сторінці формату. */
export const LABELS_PER_PAGE: Record<LabelFormat, number> = { sheet_3x8: 24, single_100: 1 };

/** Назва кешу service worker з оболонкою сканера (має збігатися з `public/sw.js`). */
export const SCAN_CACHE_NAME = "icelab-scan-v1";
