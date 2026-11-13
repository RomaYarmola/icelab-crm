import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatLongDate,
  formatTime,
  APP_TIME_ZONE,
} from "@/utils/formatDate";
import { formatKg, formatMoney, formatNumber, formatPricePerKg } from "@/utils/formatNumber";

// Intl ставить нерозривні пробіли між тисячами й перед символом валюти: для порівняння
// замінюємо їх на звичайні.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("дати за стандартом uk-UA у часовому поясі Києва", () => {
  it("працює в поясі Europe/Kyiv", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Kyiv");
  });

  it("узимку Київ це UTC+2", () => {
    const winter = new Date("2026-11-10T12:05:00Z");
    expect(formatDate(winter)).toBe("10.11.2026");
    expect(formatTime(winter)).toBe("14:05");
    expect(plain(formatDateTime(winter))).toBe("10.11.2026, 14:05");
  });

  it("влітку Київ це UTC+3", () => {
    const summer = new Date("2026-07-15T12:05:00Z");
    expect(formatTime(summer)).toBe("15:05");
  });

  it("опівночі за Києвом дата вже наступна, навіть якщо за UTC ще ні", () => {
    expect(formatDate("2026-11-10T22:30:00Z")).toBe("11.11.2026");
  });

  it("довга дата українською", () => {
    expect(formatLongDate("2026-11-10T12:00:00Z")).toBe("10 листопада");
  });
});

describe("числа, кілограми і гроші за стандартом uk-UA", () => {
  it("числа: пробіл між тисячами, кома в дробах", () => {
    expect(plain(formatNumber(1250.5))).toBe("1 250,5");
    expect(formatNumber(30)).toBe("30");
  });

  it("кілограми", () => {
    expect(formatKg(30)).toBe("30 кг");
    expect(formatKg(12.5)).toBe("12,5 кг");
  });

  it("гроші: цілі без копійок, з копійками коли вони є", () => {
    expect(plain(formatMoney(2250))).toBe("2 250 ₴");
    expect(plain(formatMoney(99.9))).toBe("99,9 ₴");
    expect(plain(formatMoney(0))).toBe("0 ₴");
  });

  it("гривня завжди «₴», а не «грн»: рядок однаковий на сервері й у браузері", () => {
    // Різні ICU (Node і браузер) пишуть валюту по-різному й ламали гідратацію екранів.
    expect(plain(formatMoney(2400))).toBe("2 400 ₴");
    expect(plain(formatMoney(99.9))).toBe("99,9 ₴");
    // Між числом і гривнею нерозривний пробіл: символ не відривається від суми на новий рядок.
    expect(formatMoney(2400).endsWith("\u00a0₴")).toBe(true);
    expect(formatMoney(2400)).not.toContain("грн");
  });

  it("ціна за кілограм: рядок із бази й число", () => {
    expect(plain(formatPricePerKg("75.00"))).toBe("75 ₴/кг");
    expect(plain(formatPricePerKg("99.9"))).toBe("99,9 ₴/кг");
    expect(plain(formatPricePerKg(1250))).toBe("1 250 ₴/кг");
  });
});
