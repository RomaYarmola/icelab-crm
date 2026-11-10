import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH } from "@/server/users";
import { generatePassword } from "../../scripts/_user-passwords";

describe("генератор паролів для скриптів", () => {
  it("дає пароль, який проходить перевірку довжини, з читабельних символів", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword();
      expect(password).toHaveLength(16);
      expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
      // Без схожих символів: 0, O, 1, l, I.
      expect(password).toMatch(/^[a-hj-km-np-zA-HJ-NP-Z2-9]+$/);
    }
  });

  it("щоразу дає новий пароль", () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(passwords.size).toBe(100);
  });
});
