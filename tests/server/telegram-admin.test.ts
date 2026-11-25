import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { profiles, telegramLinkCodes } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { USER_ROLES } from "@/server/permissions";
import {
  cancelTopicCapture,
  checkTelegramConnection,
  connectTelegramWebhook,
  createLinkCode,
  generateLinkCode,
  getIntakeStatus,
  startTopicCapture,
  unlinkTelegram,
} from "@/server/telegram/admin";
import { getTelegramSettings } from "@/server/telegram/settings";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const reply = (result: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, result })));
const api = (handler: (method: string, body: Record<string, unknown>) => unknown) => ({
  token: "1:T",
  retryDelays: [],
  fetchImpl: vi.fn((url: string, init: RequestInit) =>
    reply(handler(url.split("/").pop()!, JSON.parse(init.body as string))),
  ) as never,
});

describe("екран «Прийом заявок»: налаштування Telegram (B11, PR 1)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("лише власник: інші ролі отримують відмову", async () => {
    for (const role of USER_ROLES) {
      if (role === "owner") continue;
      await expect(getIntakeStatus(t.db, t.users[role]), role).rejects.toThrow(ForbiddenError);
      await expect(createLinkCode(t.db, t.users[role], t.users.manager.id), role).rejects.toThrow(
        ForbiddenError,
      );
      await expect(unlinkTelegram(t.db, t.users[role], t.users.manager.id), role).rejects.toThrow(
        ForbiddenError,
      );
    }
  });

  it("стан: токен і секрет «є/немає» без самих значень, менеджери й власник у списку", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    let status = await getIntakeStatus(t.db, owner());
    expect(status).toMatchObject({ hasToken: false, hasWebhookSecret: false });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "999:SECRETTOKEN");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "SECRETHOOK");
    status = await getIntakeStatus(t.db, owner());
    expect(status).toMatchObject({ hasToken: true, hasWebhookSecret: true });
    expect(JSON.stringify(status)).not.toMatch(/SECRETTOKEN|SECRETHOOK/);
    // З B17 підключаємо й працівників локацій: їм приходять нагадування про посилки з боксами.
    expect(status.users.map((u) => u.role)).toEqual(
      expect.arrayContaining(["owner", "manager", "location_lead", "production"]),
    );
    expect(status.users.length).toBeGreaterThanOrEqual(2);
  });

  it("перевірка з'єднання: бот відповідає, webhook збігається чи ні, ім'я бота запам'ятовується", async () => {
    const hooked = api((method) =>
      method === "getMe"
        ? { id: 1, username: "icelab_bot" }
        : { url: "https://app.example/api/telegram/webhook" },
    );
    const ok = await checkTelegramConnection(
      t.db,
      owner(),
      "https://app.example/api/telegram/webhook",
      hooked,
    );
    expect(ok.ok).toBe(true);
    expect(ok.message).toContain("@icelab_bot");
    expect(ok.message).toContain("до цього застосунку");
    expect((await getTelegramSettings(t.db)).botUsername).toBe("icelab_bot");
    const other = await checkTelegramConnection(
      t.db,
      owner(),
      "https://other.example/api/telegram/webhook",
      hooked,
    );
    expect(other.message).toContain("іншої адреси");
    const none = await checkTelegramConnection(
      t.db,
      owner(),
      "https://app.example/api/telegram/webhook",
      api((m) => (m === "getMe" ? { id: 1, username: "icelab_bot" } : { url: "" })),
    );
    expect(none.message).toContain("ще не підключено");
    const broken = await checkTelegramConnection(t.db, owner(), null, {
      token: "1:T",
      retryDelays: [],
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }),
            { status: 401 },
          ),
        ),
      ) as never,
    });
    expect(broken).toMatchObject({ ok: false, message: "Unauthorized" });
  });

  it("підключення webhook: лише https, потрібен секрет, до Telegram іде адреса й секрет", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    await expect(connectTelegramWebhook(t.db, owner(), "https://app.example")).rejects.toThrow(
      "Секрет webhook",
    );
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "SECRETHOOK");
    for (const bad of [
      "http://app.example",
      "https://localhost",
      "app.example",
      "https://app.example/x",
    ]) {
      await expect(connectTelegramWebhook(t.db, owner(), bad), bad).rejects.toThrow(
        ValidationError,
      );
    }
    const seen: Record<string, unknown>[] = [];
    const url = await connectTelegramWebhook(
      t.db,
      owner(),
      "https://app.example",
      api((_m, body) => {
        seen.push(body);
        return true;
      }),
    );
    expect(url).toBe("https://app.example/api/telegram/webhook");
    expect(seen[0]).toMatchObject({
      url: "https://app.example/api/telegram/webhook",
      secret_token: "SECRETHOOK",
      allowed_updates: ["message", "edited_message", "callback_query"],
    });
  });

  it("код прив'язки: 8 символів без схожих знаків, діє 24 години, новий скасовує старий, відв'язування", async () => {
    expect(generateLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const first = await createLinkCode(t.db, owner(), t.users.manager.id);
    const second = await createLinkCode(t.db, owner(), t.users.manager.id);
    const rows = await t.db
      .select()
      .from(telegramLinkCodes)
      .where(eq(telegramLinkCodes.profileId, t.users.manager.id));
    expect(rows.map((r) => r.code)).toEqual([second.code]);
    expect(first.code).not.toBe(second.code);
    const hours = (second.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    await expect(createLinkCode(t.db, owner(), t.users.production.id)).resolves.toMatchObject({
      code: expect.any(String),
    });
    await expect(
      createLinkCode(t.db, owner(), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("не знайдено");
    await t.db
      .update(profiles)
      .set({ telegramUserId: 31337 })
      .where(eq(profiles.id, t.users.manager.id));
    expect(
      (await getIntakeStatus(t.db, owner())).users.find((u) => u.id === t.users.manager.id)!
        .isLinked,
    ).toBe(true);
    await unlinkTelegram(t.db, owner(), t.users.manager.id);
    expect(
      (await getIntakeStatus(t.db, owner())).users.find((u) => u.id === t.users.manager.id)!
        .isLinked,
    ).toBe(false);
  });

  it("визначення топіка: потрібен токен і підключений Telegram власника, час очікування 10 хвилин, скасування", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await expect(startTopicCapture(t.db, owner(), "kyiv")).rejects.toThrow("токен бота");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "1:T");
    await expect(startTopicCapture(t.db, owner(), "kyiv")).rejects.toThrow(
      "підключіть свій Telegram",
    );
    await t.db.update(profiles).set({ telegramUserId: 424242 }).where(eq(profiles.id, owner().id));
    const now = new Date("2034-05-01T10:00:00Z");
    await startTopicCapture(t.db, owner(), "lviv", now);
    const capture = (await getTelegramSettings(t.db)).capture!;
    expect(capture.target).toBe("lviv");
    expect(new Date(capture.expiresAt).getTime() - now.getTime()).toBe(10 * 60_000);
    await cancelTopicCapture(t.db, owner());
    expect((await getTelegramSettings(t.db)).capture).toBeNull();
    await t.db.update(profiles).set({ telegramUserId: null }).where(eq(profiles.id, owner().id));
  });
});
