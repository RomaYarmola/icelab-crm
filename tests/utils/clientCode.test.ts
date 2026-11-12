import { describe, expect, it } from "vitest";
import {
  formatClientCode,
  isRegionPrefix,
  isValidClientCode,
  normalizeClientCode,
  parseClientCode,
} from "@/utils/clientCode";

describe("normalizeClientCode", () => {
  it("латиниця, схожа на кирилицю, стає кирилицею (D42)", () => {
    expect(normalizeClientCode("AA16")).toBe("АА16");
    expect(normalizeClientCode("BC57")).toBe("ВС57");
    expect(normalizeClientCode("AI3")).toBe("АІ3");
    expect(normalizeClientCode("KO1")).toBe("КО1");
    expect(normalizeClientCode("XM2")).toBe("ХМ2");
  });

  it("малі літери, пробіли й дефіси не заважають", () => {
    expect(normalizeClientCode(" аа 16 ")).toBe("АА16");
    expect(normalizeClientCode("aa-16")).toBe("АА16");
    expect(normalizeClientCode("ва_57")).toBe("ВА57");
    expect(normalizeClientCode("bc.57")).toBe("ВС57");
  });

  it("змішаний ввід (частина кирилицею, частина латиницею) теж зводиться", () => {
    // Перша літера кирилична «А», друга латинська «A».
    expect(normalizeClientCode("АA16")).toBe("АА16");
  });

  it("літери без кириличного двійника з позначок областей не чіпає", () => {
    expect(normalizeClientCode("ZZ1")).toBe("ZZ1");
    expect(normalizeClientCode("Q9")).toBe("Q9");
  });

  it("частковий ввід для пошуку теж нормалізується", () => {
    expect(normalizeClientCode("aa1")).toBe("АА1");
    expect(normalizeClientCode("a")).toBe("А");
    expect(normalizeClientCode("")).toBe("");
  });

  it("цифри лишаються цифрами", () => {
    expect(normalizeClientCode("21")).toBe("21");
    expect(normalizeClientCode(" 1 000 ")).toBe("1000");
  });
});

describe("isValidClientCode", () => {
  it("приймає літери кирилицею й число, а також лише цифри", () => {
    for (const code of ["АА16", "ВС57", "АІ1", "АХ8", "СН100", "21", "1000", "7"]) {
      expect(isValidClientCode(code), code).toBe(true);
    }
  });

  it("відхиляє латиницю, неправильний порядок, зайві символи й порожній код", () => {
    for (const code of [
      "AA16",
      "16АА",
      "А16",
      "ААА16",
      "АА",
      "АА-16",
      "АА 16",
      "аа16",
      "",
      "АА1.5",
    ]) {
      expect(isValidClientCode(code), code).toBe(false);
    }
  });

  it("код 404 зарезервований за клієнтом-заглушкою", () => {
    expect(isValidClientCode("404")).toBe(false);
    expect(isValidClientCode("АА404")).toBe(true);
    expect(isValidClientCode("4040")).toBe(true);
  });
});

describe("parseClientCode і formatClientCode", () => {
  it("розбирає код на префікс і номер", () => {
    expect(parseClientCode("АА16")).toEqual({ prefix: "АА", number: 16 });
    expect(parseClientCode("ВС1074")).toEqual({ prefix: "ВС", number: 1074 });
    expect(parseClientCode("21")).toEqual({ prefix: null, number: 21 });
  });

  it("для недопустимого коду повертає null", () => {
    expect(parseClientCode("AA16")).toBeNull();
    expect(parseClientCode("404")).toBeNull();
    expect(parseClientCode("")).toBeNull();
  });

  it("збирає код назад", () => {
    expect(formatClientCode("АА", 16)).toBe("АА16");
    expect(formatClientCode(null, 21)).toBe("21");
    expect(parseClientCode(formatClientCode("ВС", 57))).toEqual({ prefix: "ВС", number: 57 });
  });
});

describe("isRegionPrefix", () => {
  it("дві великі кириличні літери", () => {
    expect(isRegionPrefix("АА")).toBe(true);
    expect(isRegionPrefix("АІ")).toBe(true);
    expect(isRegionPrefix("AA")).toBe(false);
    expect(isRegionPrefix("А")).toBe(false);
    expect(isRegionPrefix("ААА")).toBe(false);
    expect(isRegionPrefix("аа")).toBe(false);
  });
});
