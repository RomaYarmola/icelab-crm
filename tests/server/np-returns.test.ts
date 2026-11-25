import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, locations, shipmentReturns, shipments } from "@/db/schema";
import { DISCOVERY_LIMIT, trackReturns } from "@/server/np/returns";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

type Answer = Record<string, string>;

/** Підмінений трекінг: відповідь за номером накладної; запам'ятовує запитані номери. */
function fakeNp(answers: Record<string, Answer>) {
  const asked: string[][] = [];
  const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      methodProperties: { Documents: { DocumentNumber: string }[] };
    };
    const numbers = body.methodProperties.Documents.map((d) => d.DocumentNumber);
    asked.push(numbers);
    const data = numbers.flatMap((number) =>
      answers[number] ? [{ Number: number, ...answers[number] }] : [],
    );
    return Promise.resolve(new Response(JSON.stringify({ success: true, data, errors: [] })));
  });
  return { asked, api: { apiKey: "k", fetchImpl: fetchImpl as never, retryDelayMs: 0 } };
}

const NOW = new Date("2034-05-10T08:00:00Z");
const hours = (count: number) => new Date(NOW.getTime() + count * 3_600_000);

describe("повернення боксів Новою Поштою (B17)", () => {
  let t: OrderTestContext;
  let counter = 0;
  const number = () => `2045${String((counter += 1)).padStart(10, "0")}`;

  async function shipment(extra: Partial<typeof shipments.$inferInsert> = {}) {
    const created = await t.create({ orderDate: "2034-04-01" });
    const ttn = number();
    const [row] = await t.db
      .insert(shipments)
      .values({
        orderId: created.id,
        locationId: t.location,
        ttnNumber: ttn,
        status: "received",
        createdInNpAt: new Date("2034-04-05T08:00:00Z"),
        ...extra,
      })
      .returning();
    return { id: row!.id, ttn };
  }
  const returnOf = async (shipmentId: string) =>
    (
      await t.db.select().from(shipmentReturns).where(eq(shipmentReturns.shipmentId, shipmentId))
    )[0];

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(shipmentReturns);
    await t.db.delete(shipments);
  });

  it("знаходить повернення й за один запуск записує статус, відділення, прибуття й платне зберігання", async () => {
    const sent = await shipment();
    const back = number();
    const [lviv] = await t.db.select().from(locations).where(eq(locations.code, "lviv"));
    const np = fakeNp({
      [sent.ttn]: { StatusCode: "9", LightReturnNumber: back },
      [back]: {
        StatusCode: "7",
        Status: "Прибув у відділення",
        CityRecipient: "Львів",
        WarehouseRecipient: "Відділення №2",
        WarehouseRecipientNumber: "2",
        ActualDeliveryDate: "2034-05-09 09:59:42",
        DatePayedKeeping: "2034-05-15 09:59:42",
        RecipientFullName: "Не зберігаємо",
        PhoneRecipient: "380000000000",
      },
    });
    const before = (await t.db.select().from(auditLog)).length;
    const result = await trackReturns(t.db, { now: NOW, api: np.api });

    expect(result).toEqual({ checked: 1, found: 1, tracked: 1, closed: 0 });
    const row = (await returnOf(sent.id))!;
    expect(row).toMatchObject({
      ttnNumber: back,
      status: "arrived",
      statusText: "Прибув у відділення",
      city: "Львів",
      warehouseNumber: "2",
      locationId: lviv!.id,
      closedAt: null,
    });
    expect(row.arrivedAt?.toISOString()).toBe("2034-05-09T06:59:42.000Z");
    expect(row.paidStorageFrom?.toISOString()).toBe("2034-05-15T06:59:42.000Z");
    expect(JSON.stringify(row)).not.toMatch(/Не зберігаємо|380000000000/);
    expect((await t.db.select().from(auditLog)).length).toBe(before);
  });

  it("без повернення перепитує не частіше ніж раз на 3 години", async () => {
    const sent = await shipment();
    const np = fakeNp({ [sent.ttn]: { StatusCode: "9" } });
    await trackReturns(t.db, { now: NOW, api: np.api });
    await trackReturns(t.db, { now: hours(2), api: np.api });
    expect(np.asked).toHaveLength(1);
    expect((await returnOf(sent.id))!.ttnNumber).toBeNull();

    const back = number();
    const later = fakeNp({
      [sent.ttn]: { StatusCode: "9", LightReturnNumber: back },
      [back]: { StatusCode: "5", CityRecipient: "Київ" },
    });
    await trackReturns(t.db, { now: hours(3), api: later.api });
    expect(await returnOf(sent.id)).toMatchObject({
      ttnNumber: back,
      status: "sent",
      arrivedAt: null,
    });
  });

  it("не перевіряє неотримані, без номера й старші за 90 днів", async () => {
    await shipment({ status: "arrived" });
    await shipment({ ttnNumber: null });
    await shipment({ createdInNpAt: new Date("2034-02-01T08:00:00Z") });
    const returned = await shipment({ status: "returned" });
    const np = fakeNp({});
    await trackReturns(t.db, { now: NOW, api: np.api });
    expect(np.asked).toEqual([[returned.ttn]]);
  });

  it("отримане повернення закривається й більше не опитується", async () => {
    const sent = await shipment();
    const back = number();
    const first = fakeNp({
      [sent.ttn]: { StatusCode: "9", LightReturnNumber: back },
      [back]: { StatusCode: "7" },
    });
    await trackReturns(t.db, { now: NOW, api: first.api });
    const second = fakeNp({ [back]: { StatusCode: "9" } });
    expect((await trackReturns(t.db, { now: hours(1), api: second.api })).closed).toBe(1);
    const third = fakeNp({});
    await trackReturns(t.db, { now: hours(10), api: third.api });
    expect(third.asked).toEqual([]);
    expect((await returnOf(sent.id))!.closedAt).not.toBeNull();
  });

  it("видалене повернення зникає, а нове з іншим номером знаходиться", async () => {
    const sent = await shipment();
    const deleted = number();
    const first = fakeNp({
      [sent.ttn]: { StatusCode: "9", LightReturnNumber: deleted },
      [deleted]: { StatusCode: "2" },
    });
    await trackReturns(t.db, { now: NOW, api: first.api });
    expect((await returnOf(sent.id))!.closedAt).not.toBeNull();

    // Той самий видалений номер не відкриває рядок знову.
    await trackReturns(t.db, { now: hours(4), api: first.api });
    expect((await returnOf(sent.id))!.closedAt).not.toBeNull();

    const fresh = number();
    const second = fakeNp({
      [sent.ttn]: { StatusCode: "9", LightReturnNumber: fresh },
      [fresh]: { StatusCode: "5" },
    });
    await trackReturns(t.db, { now: hours(8), api: second.api });
    expect(await returnOf(sent.id)).toMatchObject({
      ttnNumber: fresh,
      status: "sent",
      closedAt: null,
    });
  });

  it("«номер не знайдено» не стирає вже відоме", async () => {
    const sent = await shipment();
    const back = number();
    await trackReturns(t.db, {
      now: NOW,
      api: fakeNp({
        [sent.ttn]: { StatusCode: "9", LightReturnNumber: back },
        [back]: { StatusCode: "5", CityRecipient: "Київ" },
      }).api,
    });
    await trackReturns(t.db, { now: hours(1), api: fakeNp({ [back]: { StatusCode: "3" } }).api });
    expect(await returnOf(sent.id)).toMatchObject({ status: "sent", city: "Київ" });
  });

  it("помилка Нової Пошти кидається далі й нічого не записує", async () => {
    await shipment();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, data: [], errors: ["To many requests"] })),
      ),
    );
    await expect(
      trackReturns(t.db, {
        now: NOW,
        api: { apiKey: "k", fetchImpl: fetchImpl as never, retryDelayMs: 0 },
      }),
    ).rejects.toThrow("To many requests");
    expect(await t.db.select().from(shipmentReturns)).toEqual([]);
  });

  it("за запуск бере не більше ліміту, спершу ще не перевірені", async () => {
    const old = await shipment();
    await trackReturns(t.db, { now: NOW, api: fakeNp({ [old.ttn]: { StatusCode: "9" } }).api });
    const fresh = await shipment();
    const np = fakeNp({});
    await trackReturns(t.db, { now: hours(5), api: np.api });
    expect(np.asked[0]).toEqual([fresh.ttn, old.ttn]);
    expect(DISCOVERY_LIMIT).toBe(200);
  });
});
