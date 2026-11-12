import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH } from "@/constants/constants";
import { generatePassword, GENERATED_PASSWORD_LENGTH } from "@/utils/generatePassword";

describe("generatePassword", () => {
  it("дає пароль потрібної довжини, не коротший за мінімум", () => {
    expect(GENERATED_PASSWORD_LENGTH).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(generatePassword()).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(20)).toHaveLength(20);
  });

  it("складається з літер і цифр без схожих символів, є мала, велика літера і цифра", () => {
    for (let i = 0; i < 300; i++) {
      const password = generatePassword();
      expect(password).toMatch(/^[A-Za-z2-9]+$/);
      expect(password).not.toMatch(/[0O1lIio]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
    }
  });

  it("кожен пароль інший", () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(passwords.size).toBe(200);
  });

  it("відкидає байти, що дали б перекіс: алфавіт з 55 символів, байти від 220 пропускаємо", () => {
    // 255 і 220 вище за межу й пропускаються. Далі: 0 це «a», 25 це «C» (велика), 50 це «5» (цифра).
    const stream = [255, 220, 0, 25, 50];
    let position = 0;
    const password = generatePassword(3, (length) => {
      const chunk = new Uint8Array(length);
      for (let i = 0; i < length; i++) chunk[i] = stream[position++ % stream.length]!;
      return chunk;
    });
    expect(password).toBe("aC5");
  });
});
