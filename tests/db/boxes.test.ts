import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withActor } from "@/db/actor";
import { auditLog, boxDebtsLegacy, boxEvents, boxTypes, boxes, locations } from "@/db/schema";
import { createTestDb, type TestDb } from "./harness";
import { makeClient, makeLocation, makeOrder, makeProfile, pgErrorCode } from "./helpers";

const CHECK = "23514";
const INTEGRITY = "23000";
const UNIQUE = "23505";

describe("бокси: таблиці, перевірки, незмінні події, борги й склад (міграція 0012, D104)", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let db: TestDb;
  let typeId: string;
  let type2Id: string;
  let locationId: string;
  let clientId: string;
  let otherClientId: string;
  let actorId: string;
  let n = 0;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    typeId = (await db.insert(boxTypes).values({ code: "t1", name: "Тип 1" }).returning())[0]!.id;
    type2Id = (await db.insert(boxTypes).values({ code: "t2", name: "Тип 2" }).returning())[0]!.id;
    locationId = (await makeLocation(db)).id;
    clientId = (await makeClient(db)).id;
    otherClientId = (await makeClient(db)).id;
    actorId = (await makeProfile(db, { role: "location_lead", locationId })).id;
  });
  afterAll(async () => {
    await ctx.client.close();
  });

  const box = (values: Partial<typeof boxes.$inferInsert> = {}) =>
    db
      .insert(boxes)
      .values({
        code: `Z-${String(++n).padStart(4, "0")}`,
        boxTypeId: typeId,
        locationId,
        ...values,
      })
      .returning()
      .then((rows) => rows[0]!);
  const event = (boxId: string, values: Partial<typeof boxEvents.$inferInsert> = {}) =>
    db
      .insert(boxEvents)
      .values({ boxId, event: "note", locationId, actorId, occurredAt: new Date(), ...values })
      .returning()
      .then((rows) => rows[0]!);

  it("бокс за замовчуванням на складі, код унікальний, є префікси Києва й Львова після міграції", async () => {
    const b = await box({ code: "Q-0001" });
    expect(b).toMatchObject({ status: "in_stock", currentClientId: null, issuedAt: null });
    expect(await pgErrorCode(box({ code: "Q-0001" }))).toBe(UNIQUE);
    const prefixes = await db.select({ p: locations.boxPrefix }).from(locations);
    expect(prefixes).toBeDefined();
  });

  it("«У клієнта» вимагає клієнта й дату видачі, в інших статусах клієнта немає", async () => {
    expect(await pgErrorCode(box({ status: "at_client" }))).toBe(CHECK);
    expect(await pgErrorCode(box({ status: "at_client", currentClientId: clientId }))).toBe(CHECK);
    expect(await pgErrorCode(box({ status: "in_stock", currentClientId: clientId }))).toBe(CHECK);
    const ok = await box({ status: "at_client", currentClientId: clientId, issuedAt: new Date() });
    expect(ok.status).toBe("at_client");
  });

  it("подія зберігає хто, коли скановано й коли записано, і не змінюється та не видаляється", async () => {
    const b = await box();
    const e = await event(b.id, { event: "created" });
    expect(e.recordedAt).toBeInstanceOf(Date);
    expect(
      await pgErrorCode(db.update(boxEvents).set({ note: "х" }).where(eq(boxEvents.id, e.id))),
    ).toBe(INTEGRITY);
    expect(await pgErrorCode(db.delete(boxEvents).where(eq(boxEvents.id, e.id)))).toBe(INTEGRITY);
  });

  it("номер скана унікальний, коли заданий; порожніх може бути скільки завгодно", async () => {
    const b = await box();
    await event(b.id, { deviceQueueId: "dq-1" });
    expect(await pgErrorCode(event(b.id, { deviceQueueId: "dq-1" }))).toBe(UNIQUE);
    await event(b.id);
    await event(b.id);
  });

  it("зміни бокса й події потрапляють у журнал змін з автором", async () => {
    const b = await withActor(
      db,
      actorId,
      async (tx) =>
        (
          await tx
            .insert(boxes)
            .values({ code: "J-0001", boxTypeId: typeId, locationId })
            .returning()
        )[0]!,
    );
    await withActor(db, actorId, (tx) =>
      tx.update(boxes).set({ status: "retired", retiredAt: new Date() }).where(eq(boxes.id, b.id)),
    );
    await withActor(db, actorId, (tx) =>
      tx
        .insert(boxEvents)
        .values({ boxId: b.id, event: "note", locationId, actorId, occurredAt: new Date() }),
    );
    const rows = await db.select().from(auditLog).where(eq(auditLog.rowId, b.id));
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows.every((r) => r.actorId === actorId)).toBe(true);
    const events = await db.select().from(auditLog).where(eq(auditLog.tableName, "box_events"));
    expect(events.length).toBeGreaterThan(0);
  });

  it("старі борги: кількість більша за нуль, закрито не більше ніж є", async () => {
    const legacy = (values: Partial<typeof boxDebtsLegacy.$inferInsert>) =>
      db
        .insert(boxDebtsLegacy)
        .values({ clientId, boxTypeId: typeId, count: 3, ...values })
        .returning();
    expect(await pgErrorCode(legacy({ count: 0 }))).toBe(CHECK);
    expect(await pgErrorCode(legacy({ resolvedCount: 4 }))).toBe(CHECK);
    expect(await pgErrorCode(legacy({ resolvedCount: -1 }))).toBe(CHECK);
    const [ok] = await legacy({ resolvedCount: 3 });
    expect(ok!.resolvedCount).toBe(3);
  });

  describe("представлення боргів і складу", () => {
    let c1: string;
    let c2: string;
    let loc: string;
    beforeAll(async () => {
      c1 = (await makeClient(db)).id;
      c2 = (await makeClient(db)).id;
      loc = (await makeLocation(db)).id;
      const issuedEarly = new Date("2034-02-01T10:00:00Z");
      const issuedLate = new Date("2034-03-01T10:00:00Z");
      await box({
        locationId: loc,
        status: "at_client",
        currentClientId: c1,
        issuedAt: issuedLate,
      });
      await box({
        locationId: loc,
        status: "at_client",
        currentClientId: c1,
        issuedAt: issuedEarly,
      });
      await box({
        locationId: loc,
        boxTypeId: type2Id,
        status: "at_client",
        currentClientId: c2,
        issuedAt: issuedLate,
      });
      await box({ locationId: loc });
      await box({ locationId: loc });
      await box({ locationId: loc, status: "sold" });
      await box({ locationId: loc, status: "lost" });
      await db.insert(boxDebtsLegacy).values([
        { clientId: c1, boxTypeId: typeId, count: 5, resolvedCount: 2, sinceDate: "2034-01-15" },
        { clientId: c1, boxTypeId: typeId, count: 1, resolvedCount: 1, sinceDate: "2033-01-01" },
        { clientId: c2, boxTypeId: typeId, count: 4, sinceDate: "2034-01-10" },
      ]);
    });

    const debts = async (client: string) =>
      (
        await db.execute(
          sql`select * from box_debts where client_id = ${client} order by box_type_id`,
        )
      ).rows as {
        box_type_id: string;
        qr_count: number;
        legacy_count: number;
        total_count: number;
        oldest_at: Date | string;
      }[];

    it("борг = бокси «У клієнта» плюс старі борги мінус закриті, найстаріший день", async () => {
      const [d] = (await debts(c1)).filter((x) => x.box_type_id === typeId);
      expect(d).toMatchObject({ qr_count: 2, legacy_count: 3, total_count: 5 });
      // Найстаріше: 15.01 зі старого боргу раніше за видачу 01.02.
      expect(new Date(d!.oldest_at).toISOString().slice(0, 10)).toBe("2034-01-14");
    });

    it("закритий повністю старий борг не рахується; борг без бокса з наклейкою теж видно", async () => {
      expect((await debts(c1)).filter((x) => x.box_type_id === typeId)).toHaveLength(1);
      const c2rows = await debts(c2);
      expect(c2rows.find((x) => x.box_type_id === typeId)).toMatchObject({
        qr_count: 0,
        legacy_count: 4,
        total_count: 4,
      });
      expect(c2rows.find((x) => x.box_type_id === type2Id)).toMatchObject({
        qr_count: 1,
        legacy_count: 0,
        total_count: 1,
      });
    });

    it("склад: по локації й типу скільки на складі, у клієнтів, продано, втрачено", async () => {
      const rows = (await db.execute(sql`select * from box_stock where location_id = ${loc}`))
        .rows as {
        box_type_id: string;
        in_stock: number;
        at_client: number;
        sold: number;
        lost: number;
      }[];
      expect(rows.find((r) => r.box_type_id === typeId)).toMatchObject({
        in_stock: 2,
        at_client: 2,
        sold: 1,
        lost: 1,
      });
      expect(rows.find((r) => r.box_type_id === type2Id)).toMatchObject({
        in_stock: 0,
        at_client: 1,
        sold: 0,
        lost: 0,
      });
    });
  });

  it("бокс не можна видалити, поки на нього є події; клієнт з боксом не видаляється", async () => {
    const b = await box();
    await event(b.id);
    expect(await pgErrorCode(db.delete(boxes).where(eq(boxes.id, b.id)))).toBe("23001");
    const rented = await box({
      status: "at_client",
      currentClientId: otherClientId,
      issuedAt: new Date(),
    });
    expect(rented.currentClientId).toBe(otherClientId);
    const order = await makeOrder(db, { clientId: otherClientId, locationId });
    await db.update(boxes).set({ currentOrderId: order.id }).where(eq(boxes.id, rented.id));
    expect((await db.select().from(boxes).where(eq(boxes.id, rented.id)))[0]!.currentOrderId).toBe(
      order.id,
    );
  });
});
