import { describe, expect, it } from "vitest";
import { shouldShowInstallHint, type InstallHintEnvironment } from "@/utils/installHint";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const env = (overrides: Partial<InstallHintEnvironment>): InstallHintEnvironment => ({
  userAgent: ANDROID,
  platform: "Linux armv81",
  maxTouchPoints: 5,
  isStandalone: false,
  ...overrides,
});

describe("підказка «Додати на головний екран»", () => {
  it("показується на iPhone в браузері", () => {
    expect(shouldShowInstallHint(env({ userAgent: IPHONE, platform: "iPhone" }))).toBe(true);
  });

  it("показується на iPad, навіть у режимі «сайт для комп'ютера» (видає себе за Mac з дотиковим екраном)", () => {
    expect(
      shouldShowInstallHint(env({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 })),
    ).toBe(true);
  });

  it("не показується, якщо застосунок уже відкрито з головного екрана", () => {
    expect(
      shouldShowInstallHint(env({ userAgent: IPHONE, platform: "iPhone", isStandalone: true })),
    ).toBe(false);
  });

  it("не показується в Android (там браузер сам пропонує) і на звичайному Mac без дотику", () => {
    expect(shouldShowInstallHint(env({ userAgent: ANDROID }))).toBe(false);
    expect(
      shouldShowInstallHint(env({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 })),
    ).toBe(false);
  });
});
