import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { locations } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeProfile } from "./helpers";

describe("withActor", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let actorId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    actorId = (await makeProfile(db)).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  async function seen(runner: Pick<TestDb, "execute">) {
    const result = await runner.execute(
      sql`select current_actor() as actor, current_change_note() as note`,
    );
    return result.rows[0] as { actor: string | null; note: string | null };
  }

  it("поза withActor автор порожній (системна зміна)", async () => {
    expect(await seen(db)).toEqual({ actor: null, note: null });
  });

  it("усередині транзакції база бачить автора і примітку, після неї вже ні", async () => {
    const inside = await withActor(db, actorId, (tx) => seen(tx), { note: "Причина" });
    expect(inside).toEqual({ actor: actorId, note: "Причина" });
    expect(await seen(db)).toEqual({ actor: null, note: null });
  });

  it("actorId = null означає системну зміну", async () => {
    expect(await withActor(db, null, (tx) => seen(tx))).toEqual({ actor: null, note: null });
  });

  it("при помилці скасовує всі зміни транзакції", async () => {
    await expect(
      withActor(db, actorId, async (tx) => {
        await tx.insert(locations).values({ code: "temp", name: "Тимчасова" });
        throw new Error("збій");
      }),
    ).rejects.toThrow("збій");

    expect(await db.select().from(locations).where(eq(locations.code, "temp"))).toEqual([]);
  });
});
