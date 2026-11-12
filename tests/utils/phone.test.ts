import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneSearchDigits } from "@/utils/phone";

describe("normalizePhone", () => {
  it("українські номери в різних записах дають один і той самий E.164", () => {
    const expected = "+380501234567";
    for (const input of [
      "050 123 45 67",
      "0501234567",
      "(050) 123-45-67",
      "+38 050 123 45 67",
      "+380501234567",
      "380501234567",
      "380 50 123 45 67",
      "80501234567",
      "00380501234567",
      "501234567",
      "  +38(050)123-45-67  ",
    ]) {
      expect(normalizePhone(input), input).toBe(expected);
    }
  });

  it("міжнародні номери потребують плюса або 00", () => {
    expect(normalizePhone("+48 600 123 456")).toBe("+48600123456");
    expect(normalizePhone("0048600123456")).toBe("+48600123456");
    // Без плюса чужий номер не вгадуємо.
    expect(normalizePhone("48600123456")).toBeNull();
  });

  it("сміття й надто короткі чи довгі номери дають null", () => {
    for (const input of [
      "",
      "   ",
      "abc",
      "050",
      "12345",
      "+1234567",
      "+1234567890123456",
      "тел.",
    ]) {
      expect(normalizePhone(input), input).toBeNull();
    }
  });

  it("результат завжди проходить перевірку бази (+ і від 8 до 15 цифр)", () => {
    for (const input of ["0501234567", "+38 067 111 22 33", "380931112233"]) {
      expect(normalizePhone(input)).toMatch(/^\+[0-9]{8,15}$/);
    }
  });
});

describe("phoneSearchDigits", () => {
  it("витягує цифри від трьох", () => {
    expect(phoneSearchDigits("050 123")).toBe("050123");
    expect(phoneSearchDigits("+38 050")).toBe("38050");
    expect(phoneSearchDigits("4567")).toBe("4567");
    expect(phoneSearchDigits("123")).toBe("123");
  });

  it("коротший запит чи запит із літерами не вважається телефоном", () => {
    expect(phoneSearchDigits("12")).toBeNull();
    expect(phoneSearchDigits("АА16")).toBeNull();
    expect(phoneSearchDigits("кафе 123")).toBeNull();
    expect(phoneSearchDigits("")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("українські номери з пробілами для читання", () => {
    expect(formatPhone("+380501234567")).toBe("+38 050 123 45 67");
  });

  it("інші номери без змін", () => {
    expect(formatPhone("+48600123456")).toBe("+48600123456");
    expect(formatPhone("")).toBe("");
  });
});
