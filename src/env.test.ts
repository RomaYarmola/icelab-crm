import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/env";

const validUrl = "postgresql://user:secret-password@host.example.com:5432/postgres";

describe("parseEnv", () => {
  it("приймає мінімальний набір і ставить APP_ENV=dev за замовчуванням", () => {
    const env = parseEnv({ DATABASE_URL: validUrl });
    expect(env.APP_ENV).toBe("dev");
    expect(env.DATABASE_URL).toBe(validUrl);
  });

  it("відхиляє відсутній DATABASE_URL і називає змінну", () => {
    expect(() => parseEnv({})).toThrowError(EnvError);
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("відхиляє невідоме значення APP_ENV", () => {
    expect(() => parseEnv({ DATABASE_URL: validUrl, APP_ENV: "test" })).toThrowError(/APP_ENV/);
  });

  it("не розкриває значень змінних у тексті помилки", () => {
    let message = "";
    try {
      parseEnv({ DATABASE_URL: "це не url secret-password" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("secret-password");
  });

  it("вважає порожній рядок відсутнім значенням для необов'язкових змінних", () => {
    const env = parseEnv({ DATABASE_URL: validUrl, NEXT_PUBLIC_SUPABASE_URL: "" });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it("перевіряє формат URL Supabase, якщо його задано", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: validUrl, NEXT_PUBLIC_SUPABASE_URL: "не-url" }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
