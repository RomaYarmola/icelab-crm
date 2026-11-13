import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProductionRealtimeConfig,
  PRODUCTION_SIGNAL_EVENT,
  productionTopic,
  sendProductionSignal,
} from "@/server/production-signal";

const URL_VALUE = "https://example-project.supabase.co";

function setEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_VALUE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
}

describe("сигнал екрана виробництва (D64)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("назва каналу", () => {
    it("та сама для тієї самої локації й ключа, різна для різних локацій і ключів", () => {
      const a = productionTopic("loc-1", "secret-a");
      expect(productionTopic("loc-1", "secret-a")).toBe(a);
      expect(productionTopic("loc-2", "secret-a")).not.toBe(a);
      expect(productionTopic("loc-1", "secret-b")).not.toBe(a);
    });

    it("не містить id локації чи ключа, має прийнятну довжину й символи", () => {
      const topic = productionTopic("11111111-2222-3333-4444-555555555555", "very-secret-value");
      expect(topic).toMatch(/^production-[A-Za-z0-9_-]{32}$/);
      expect(topic).not.toContain("11111111");
      expect(topic).not.toContain("very-secret");
    });
  });

  describe("налаштування для браузера", () => {
    it("без змінних Supabase налаштування немає (екран живе на опитуванні)", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      expect(getProductionRealtimeConfig(["loc-1"])).toBeNull();
    });

    it("з ними віддає адресу, публічний ключ і канал, але не секретний ключ", () => {
      setEnv();
      const config = getProductionRealtimeConfig(["loc-1", "loc-2", "loc-1"]);
      expect(config).toMatchObject({
        url: URL_VALUE,
        publishableKey: "sb_publishable_test_key",
      });
      expect(config?.topics).toEqual([
        productionTopic("loc-1", "sb_secret_test_key"),
        productionTopic("loc-2", "sb_secret_test_key"),
      ]);
      expect(JSON.stringify(config)).not.toContain("sb_secret");
    });

    it("без локацій налаштування немає", () => {
      setEnv();
      expect(getProductionRealtimeConfig([])).toBeNull();
    });
  });

  describe("відправка", () => {
    it("шле одне пакетне повідомлення з порожніми даними в канали унікальних локацій", async () => {
      setEnv();
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const sent = await sendProductionSignal(["loc-1", "loc-2", "loc-1"], fetcher);
      expect(sent).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(`${URL_VALUE}/realtime/v1/api/broadcast`);
      expect(init.method).toBe("POST");
      expect(init.headers.apikey).toBe("sb_secret_test_key");
      const body = JSON.parse(init.body as string);
      expect(body.messages).toHaveLength(2);
      for (const message of body.messages) {
        expect(message).toMatchObject({ event: PRODUCTION_SIGNAL_EVENT, payload: {} });
        expect(message.topic).toMatch(/^production-/);
      }
      expect(body.messages[0].topic).toBe(productionTopic("loc-1", "sb_secret_test_key"));
    });

    it("відмова сервісу й мережева помилка не кидають помилку, а повертають false", async () => {
      setEnv();
      expect(await sendProductionSignal(["loc-1"], vi.fn().mockResolvedValue({ ok: false }))).toBe(
        false,
      );
      expect(
        await sendProductionSignal(["loc-1"], vi.fn().mockRejectedValue(new Error("offline"))),
      ).toBe(false);
    });

    it("без змінних Supabase і без локацій нічого не шле", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      const fetcher = vi.fn();
      expect(await sendProductionSignal(["loc-1"], fetcher)).toBe(false);
      setEnv();
      expect(await sendProductionSignal([], fetcher)).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
