import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telegram/webhook/route";
import { isTelegramRequest, TELEGRAM_SECRET_HEADER } from "@/server/telegram/webhook-auth";

const request = (secret?: string, body = "{}") =>
  new Request("http://x/api/telegram/webhook", {
    method: "POST",
    headers: secret ? { [TELEGRAM_SECRET_HEADER]: secret } : {},
    body,
  });

describe("webhook Telegram: секрет (B11)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("без налаштованого секрету, без заголовка й з чужим секретом доступу немає", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect(isTelegramRequest(request("anything"))).toBe(false);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "right-secret");
    expect(isTelegramRequest(request())).toBe(false);
    expect(isTelegramRequest(request("other-secret-x"))).toBe(false);
    expect(isTelegramRequest(request("right-secret"))).toBe(true);
  });

  it("приймач: 401 без секрету, 400 для порожнього тіла з правильним секретом, нічого не пишеться", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "right-secret");
    expect((await POST(request("wrong-secret"))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("right-secret", "не json"))).status).toBe(400);
  });
});
