import { describe, expect, it } from "vitest";
import { originFromHeaders } from "@/lib/request-origin";

const headers = (init: Record<string, string>) => new Headers(init);

describe("адреса застосунку за заголовками запиту", () => {
  it("локальний запуск: http і порт", () => {
    expect(originFromHeaders(headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originFromHeaders(headers({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
  });

  it("за проксі Vercel береться публічний хост і протокол із x-forwarded-*", () => {
    expect(
      originFromHeaders(
        headers({
          host: "internal-host",
          "x-forwarded-host": "crm.icelab.com.ua",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://crm.icelab.com.ua");
  });

  it("без x-forwarded-proto для не локального хоста вважає https", () => {
    expect(originFromHeaders(headers({ host: "icelab-crm-git-b2-auth-team.vercel.app" }))).toBe(
      "https://icelab-crm-git-b2-auth-team.vercel.app",
    );
  });

  it("бере перше значення зі списку через кому", () => {
    expect(
      originFromHeaders(
        headers({
          "x-forwarded-host": "crm.icelab.com.ua, proxy.internal",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://crm.icelab.com.ua");
  });

  it("відхиляє відсутній або підозрілий хост", () => {
    expect(() => originFromHeaders(headers({}))).toThrowError(/адресу застосунку/);
    for (const host of ["evil.com/path", "evil.com?x=1", "a b", "evil.com@attacker.com", "x:abc"]) {
      expect(() => originFromHeaders(headers({ host })), host).toThrowError();
    }
  });

  it("ігнорує невідомий протокол", () => {
    expect(
      originFromHeaders(headers({ host: "crm.icelab.com.ua", "x-forwarded-proto": "javascript" })),
    ).toBe("https://crm.icelab.com.ua");
  });
});
