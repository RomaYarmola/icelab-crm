import { describe, expect, it } from "vitest";
import { getInitial } from "@/utils/initials";

describe("getInitial", () => {
  it("бере першу літеру імені великою", () => {
    expect(getInitial("Ірина Коваль")).toBe("І");
    expect(getInitial("олег")).toBe("О");
  });

  it("пропускає пробіли на початку", () => {
    expect(getInitial("  Марко")).toBe("М");
  });

  it("для порожнього імені дає знак питання", () => {
    expect(getInitial("")).toBe("?");
    expect(getInitial("   ")).toBe("?");
  });
});
