import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { clients } from "@/db/schema";
import { isCodeConflict, nextClientCode, retryOnCodeConflict } from "@/server/client-codes";
import { createTestDb, type TestDb } from "../db/harness";
import { makeClient, makeProfile } from "../db/helpers";

describe("видача коду клієнта (D42)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.client.close();
  });
  beforeEach(async () => {
    await db.delete(clients);
  });

  const next = (prefix: string | null) => withActor(db, null, (tx) => nextClientCode(tx, prefix));

  it("для порожньої бази починає з 1", async () => {
    expect(await next("АА")).toBe("АА1");
    expect(await next(null)).toBe("1");
  });

  it("наступний номер це найбільший у префіксі плюс 1, а не кількість клієнтів", async () => {
    await makeClient(db, { code: "АА15" });
    await makeClient(db, { code: "АА3" });
    await makeClient(db, { code: "АА100" });
    expect(await next("АА")).toBe("АА101");
  });

  it("інші префікси й цифрові коди не впливають", async () => {
    await makeClient(db, { code: "АА15" });
    await makeClient(db, { code: "АІ99" });
    await makeClient(db, { code: "ВС500" });
    await makeClient(db, { code: "700" });
    expect(await next("АА")).toBe("АА16");
    expect(await next("АІ")).toBe("АІ100");
    expect(await next("ВС")).toBe("ВС501");
    expect(await next("АХ")).toBe("АХ1");
  });

  it("видалені клієнти враховуються: їхній код лишається зайнятим", async () => {
    await makeClient(db, { code: "АА20", deletedAt: new Date() });
    expect(await next("АА")).toBe("АА21");
  });

  it("об'єднані клієнти (теж видалені) враховуються", async () => {
    const main = await makeClient(db, { code: "АА1" });
    await makeClient(db, { code: "АА30", deletedAt: new Date(), mergedIntoId: main.id });
    expect(await next("АА")).toBe("АА31");
  });

  it("цифровий код: найбільший цифровий плюс 1, літерні коди не чіпає", async () => {
    await makeClient(db, { code: "10" });
    await makeClient(db, { code: "21" });
    await makeClient(db, { code: "АА500" });
    expect(await next(null)).toBe("22");
  });

  it("клієнта-заглушку 404 не враховує, а код 404 пропускає", async () => {
    await makeClient(db, { code: "404", name: "Новий клієнт", isPlaceholder: true });
    await makeClient(db, { code: "21" });
    expect(await next(null)).toBe("22");

    await makeClient(db, { code: "403" });
    // Наступний був би 404: зарезервований за заглушкою, тому 405.
    expect(await next(null)).toBe("405");
  });

  it("великі номери не ламають видачу", async () => {
    await makeClient(db, { code: "ВС12345" });
    expect(await next("ВС")).toBe("ВС12346");
  });

  it("префікс латиницею або чужого вигляду відхиляється", async () => {
    for (const prefix of ["AA", "А", "ААА", "аа", "А1", ""]) {
      await expect(next(prefix)).rejects.toThrow("Некоректний префікс");
    }
  });

  it("кілька одночасних створень в одній області дають різні коди", async () => {
    await makeClient(db, { code: "АА5" });
    const actor = (await makeProfile(db, { fullName: "Менеджер коду" })).id;
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        withActor(db, actor, async (tx) => {
          const code = await nextClientCode(tx, "АА");
          await tx.insert(clients).values({ code, name: `Паралельний ${index}` });
          return code;
        }),
      ),
    );
    expect(new Set(created).size).toBe(6);
    expect([...created].sort()).toEqual(["АА10", "АА6", "АА7", "АА8", "АА9", "АА11"].sort());
  });
});

describe("повтор при збігу коду", () => {
  const conflict = () =>
    Object.assign(new Error('duplicate key value violates unique constraint "clients_code_uq"'), {
      cause: { code: "23505", constraint: "clients_code_uq" },
    });

  it("розпізнає збіг коду і не плутає з іншими помилками", () => {
    expect(isCodeConflict(conflict())).toBe(true);
    expect(
      isCodeConflict(
        Object.assign(new Error("x"), { cause: { code: "23505", constraint: "profiles_pkey" } }),
      ),
    ).toBe(false);
    expect(isCodeConflict(Object.assign(new Error("x"), { code: "23514" }))).toBe(false);
    expect(isCodeConflict(new Error("щось інше"))).toBe(false);
    // Без назви обмеження дивимось на текст помилки.
    expect(
      isCodeConflict(
        Object.assign(new Error('unique constraint "clients_code_uq"'), {
          cause: { code: "23505" },
        }),
      ),
    ).toBe(true);
  });

  it("повторює, доки не вдасться, і віддає результат", async () => {
    let calls = 0;
    const result = await retryOnCodeConflict(async () => {
      calls += 1;
      if (calls < 3) throw conflict();
      return "ок";
    });
    expect(result).toBe("ок");
    expect(calls).toBe(3);
  });

  it("після вичерпання спроб віддає помилку", async () => {
    let calls = 0;
    await expect(
      retryOnCodeConflict(async () => {
        calls += 1;
        throw conflict();
      }, 3),
    ).rejects.toThrow("clients_code_uq");
    expect(calls).toBe(3);
  });

  it("інші помилки не повторює", async () => {
    let calls = 0;
    await expect(
      retryOnCodeConflict(async () => {
        calls += 1;
        throw new Error("збій");
      }),
    ).rejects.toThrow("збій");
    expect(calls).toBe(1);
  });
});
