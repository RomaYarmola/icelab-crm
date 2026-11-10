import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "@/lib/client-ip";

const headers = (init: Record<string, string>) => new Headers(init);

describe("адреса клієнта за заголовками", () => {
  it("віддає перевагу заголовку Vercel, потім x-real-ip, потім першому x-forwarded-for", () => {
    expect(
      clientIpFromHeaders(
        headers({
          "x-vercel-forwarded-for": "203.0.113.7",
          "x-real-ip": "198.51.100.1",
          "x-forwarded-for": "192.0.2.1",
        }),
      ),
    ).toBe("203.0.113.7");
    expect(
      clientIpFromHeaders(headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "192.0.2.1" })),
    ).toBe("198.51.100.1");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": " 192.0.2.1 , 10.0.0.1" }))).toBe(
      "192.0.2.1",
    );
  });

  it("підтримує IPv6", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("повертає null, якщо адреси немає або вона має неправильний вигляд", () => {
    expect(clientIpFromHeaders(headers({}))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "999.1.1.1" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1.1.1.1; DROP TABLE" }))).toBeNull();
  });

  it("неправильний заголовок Vercel не заважає взяти наступний", () => {
    expect(
      clientIpFromHeaders(
        headers({ "x-vercel-forwarded-for": "garbage", "x-real-ip": "198.51.100.1" }),
      ),
    ).toBe("198.51.100.1");
  });
});
