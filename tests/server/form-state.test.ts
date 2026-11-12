import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";
import { readText, runFormAction, UNEXPECTED_ERROR_MESSAGE } from "@/server/form-state";
import { reportError } from "@/server/error-log";
import { ForbiddenError } from "@/server/guards";

vi.mock("@/server/error-log", () => ({ reportError: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(reportError).mockClear();
});

describe("runFormAction: стан форми після дії", () => {
  it("успіх повертає повідомлення", async () => {
    const state = await runFormAction(async () => {}, { success: "Готово." });
    expect(state).toEqual({ status: "success", message: "Готово." });
  });

  it("помилку введення показує як є і повертає введені значення", async () => {
    const state = await runFormAction(
      async () => {
        throw new ValidationError("Вкажіть коректний e-mail.");
      },
      { success: "Готово.", values: { email: "abc" } },
    );
    expect(state).toEqual({
      status: "error",
      message: "Вкажіть коректний e-mail.",
      values: { email: "abc" },
    });
  });

  it("відмову за правами показує як є, без введених значень", async () => {
    const state = await runFormAction(
      async () => {
        throw new ForbiddenError();
      },
      { success: "Готово.", values: { email: "abc" } },
    );
    expect(state.status).toBe("error");
    expect(state.message).toBe("Недостатньо прав для цієї дії.");
    expect(state.values).toBeUndefined();
  });

  it("непередбачену помилку ховає за загальним повідомленням і записує в журнал помилок", async () => {
    const failure = new Error("з'єднання з базою розірвано, пароль=секрет");
    const state = await runFormAction(
      async () => {
        throw failure;
      },
      { success: "Готово." },
    );
    expect(state.status).toBe("error");
    expect(state.message).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(JSON.stringify(state)).not.toContain("секрет");
    expect(reportError).toHaveBeenCalledWith({ source: "form_action", error: failure });
  });

  it("помилки введення й відмови в журнал помилок не пишуться: це не збій системи", async () => {
    await runFormAction(
      async () => {
        throw new ValidationError("Некоректно.");
      },
      { success: "Готово." },
    );
    await runFormAction(
      async () => {
        throw new ForbiddenError();
      },
      { success: "Готово." },
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it("службові помилки Next.js (redirect) пропускає далі, а не ховає як помилку форми", async () => {
    await expect(
      runFormAction(
        async () => {
          redirect("/more/users");
        },
        { success: "Готово." },
      ),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("readText", () => {
  it("повертає текст поля або порожній рядок", () => {
    const form = new FormData();
    form.set("name", "Ірина");
    form.set("file", new Blob(["x"]), "x.txt");
    expect(readText(form, "name")).toBe("Ірина");
    expect(readText(form, "missing")).toBe("");
    expect(readText(form, "file")).toBe("");
  });
});
