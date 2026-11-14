import { describe, expect, it } from "vitest";
import {
  counterLabel,
  entryFromOutcome,
  isRepeatScan,
  pushEntry,
  REPEAT_WINDOW_MS,
} from "@/utils/scanSession";

describe("сканер боксів: допоміжні функції (B9)", () => {
  it("той самий код у вікні 3 с це повторний скан камери, інший код чи пізніше ні", () => {
    const last = { code: "K-0001", at: 10_000 };
    expect(isRepeatScan(last, "K-0001", 10_000 + REPEAT_WINDOW_MS - 1)).toBe(true);
    expect(isRepeatScan(last, "K-0001", 10_000 + REPEAT_WINDOW_MS)).toBe(false);
    expect(isRepeatScan(last, "K-0002", 10_500)).toBe(false);
    expect(isRepeatScan(null, "K-0001", 10_500)).toBe(false);
  });

  it("лічильник «3 з 4», без потрібної кількості просто число", () => {
    expect(counterLabel(3, 4)).toBe("3 з 4");
    expect(counterLabel(0, 2)).toBe("0 з 2");
    expect(counterLabel(5, 0)).toBe("5");
  });

  it("список скану: новий угорі й не довший за ліміт", () => {
    let list = [] as ReturnType<typeof pushEntry>;
    for (let i = 0; i < 35; i++) {
      list = pushEntry(
        list,
        entryFromOutcome(String(i), { code: "K-0001", result: "ok", message: "Видано" }),
      );
    }
    expect(list).toHaveLength(30);
    expect(list[0]!.id).toBe("34");
  });
});
