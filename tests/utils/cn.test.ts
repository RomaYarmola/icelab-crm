import { describe, expect, it } from "vitest";
import { cn } from "@/utils/cn";

describe("cn: склеювання класів Tailwind", () => {
  it("лишає розмір тексту з токена і колір тексту разом", () => {
    expect(cn("text-h1 text-navy")).toBe("text-h1 text-navy");
    expect(cn("text-body", "text-grey-text")).toBe("text-body text-grey-text");
  });

  it("пізніший розмір тексту замінює ранній, колір лишається", () => {
    expect(cn("text-h1 text-navy", "text-h2")).toBe("text-navy text-h2");
  });

  it("пізніший колір тексту замінює ранній, розмір лишається", () => {
    expect(cn("text-lead text-navy", "text-red-error")).toBe("text-lead text-red-error");
  });

  it("пізніше закруглення з токена замінює раніше", () => {
    expect(cn("rounded-field", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-card", "rounded-field")).toBe("rounded-field");
  });

  it("пропускає порожні й хибні значення", () => {
    expect(cn("w-full", false, undefined, null, "")).toBe("w-full");
    expect(cn("w-full", true && "min-h-13")).toBe("w-full min-h-13");
  });
});
