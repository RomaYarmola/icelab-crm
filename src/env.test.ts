import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  getEnv,
  getSupabaseAdminEnv,
  getSupabaseEnv,
  parseEnv,
  parseSupabaseAdminEnv,
  parseSupabaseEnv,
} from "@/env";

const validUrl = "postgresql://user:secret-password@host.example.com:5432/postgres";
const otherUrl = "postgresql://user:other-password@other.example.com:5432/postgres";

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

const supabaseUrl = "https://project-ref.supabase.co";

describe("змінні Supabase для входу", () => {
  it("вимагає адресу проєкту і публічний ключ та називає відсутні змінні", () => {
    expect(() => parseSupabaseEnv({})).toThrowError(EnvError);
    expect(() => parseSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl })).toThrowError(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("приймає повний набір і не вимагає секретного ключа", () => {
    const env = parseSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(supabaseUrl);
  });

  it("не приймає секретний ключ у публічній змінній і публічний у секретній (їх легко переплутати)", () => {
    const jwt = (role: string) =>
      `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    const url = { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl };

    // Публічна змінна потрапляє в браузер: секретний ключ там неприпустимий.
    expect(() =>
      parseSupabaseEnv({ ...url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(() =>
      parseSupabaseEnv({ ...url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    // Старий публічний ключ (anon) у публічній змінній допустимий.
    expect(
      parseSupabaseEnv({ ...url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }),
    ).toBeDefined();
    // Загальна схема теж не пропускає секретний ключ у публічну змінну.
    expect(() =>
      parseEnv({
        DATABASE_URL: validUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);

    // Секретна змінна: публічний ключ неприпустимий.
    const base = { ...url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    expect(() =>
      parseSupabaseAdminEnv({ ...base, SUPABASE_SECRET_KEY: "sb_publishable_test" }),
    ).toThrowError(/SUPABASE_SECRET_KEY/);
    expect(() => parseSupabaseAdminEnv({ ...base, SUPABASE_SECRET_KEY: jwt("anon") })).toThrowError(
      /SUPABASE_SECRET_KEY/,
    );
    expect(
      parseSupabaseAdminEnv({ ...base, SUPABASE_SECRET_KEY: jwt("service_role") }),
    ).toBeDefined();
  });

  it("для керування користувачами вимагає ще й секретний ключ, не розкриваючи його значення", () => {
    const base = {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    };
    expect(() => parseSupabaseAdminEnv(base)).toThrowError(/SUPABASE_SECRET_KEY/);
    expect(parseSupabaseAdminEnv({ ...base, SUPABASE_SECRET_KEY: "sb_secret_test" })).toMatchObject(
      { SUPABASE_SECRET_KEY: "sb_secret_test" },
    );

    let message = "";
    try {
      parseSupabaseAdminEnv({ ...base, NEXT_PUBLIC_SUPABASE_URL: "не-url sb_secret_leak" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).not.toContain("sb_secret_leak");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getSupabaseEnv і getSupabaseAdminEnv підхоплюють зміну змінних без перезапуску", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => getSupabaseEnv()).toThrowError(EnvError);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    expect(getSupabaseEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_test");
    expect(() => getSupabaseAdminEnv()).toThrowError(/SUPABASE_SECRET_KEY/);

    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    expect(getSupabaseAdminEnv().SUPABASE_SECRET_KEY).toBe("sb_secret_test");
  });

  it("повертає той самий об'єкт, поки змінні не змінилися", () => {
    vi.stubEnv("DATABASE_URL", validUrl);
    expect(getEnv()).toBe(getEnv());
  });

  it("підхоплює зміну змінних без перезапуску", () => {
    vi.stubEnv("DATABASE_URL", validUrl);
    expect(getEnv().DATABASE_URL).toBe(validUrl);

    vi.stubEnv("DATABASE_URL", otherUrl);
    expect(getEnv().DATABASE_URL).toBe(otherUrl);
  });

  it("після помилки перевіряє змінні знову й одужує, коли їх виправлено", () => {
    vi.stubEnv("DATABASE_URL", "це не url");
    expect(() => getEnv()).toThrowError(EnvError);

    vi.stubEnv("DATABASE_URL", validUrl);
    expect(getEnv().DATABASE_URL).toBe(validUrl);
  });
});
