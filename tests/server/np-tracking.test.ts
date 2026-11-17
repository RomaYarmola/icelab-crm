import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditLog, orderStatusHistory, orders, shipments } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { markShippedBySystem, transitionOrder } from "@/server/order-status";
import {
  getTrackingStatus,
  mapNpStatus,
  refreshShipmentStatus,
  trackShipments,
  TRACKING_BATCH,
} from "@/server/np/tracking";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

/** Підмінений трекінг: код статусу за номером ТТН; запам'ятовує, скільки номерів у кожному запиті. */
function fakeTracking(statuses: Record<string, string | undefined>) {
  const sizes: number[] = [];
  const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      methodProperties: { Documents: { DocumentNumber: string }[] };
    };
    sizes.push(body.methodProperties.Documents.length);
    const data = body.methodProperties.Documents.flatMap(({ DocumentNumber }) => {
      const code = statuses[DocumentNumber];
      return code === undefined
        ? []
        : [{ Number: DocumentNumber, StatusCode: code, Status: `Статус ${code}` }];
    });
    return Promise.resolve(new Response(JSON.stringify({ success: true, data, errors: [] })));
  });
  return { sizes, api: { apiKey: "k", fetchImpl: fetchImpl as never, retryDelayMs: 0 } };
}

describe("трекінг накладних Нової Пошти (B10, PR 5)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  let counter = 0;

  /** Замовлення в потрібному статусі з накладною. */
  async function shipment(
    status: "confirmed" | "packed",
    shipmentStatus: typeof shipments.$inferInsert.status = "created",
    extra: Partial<typeof shipments.$inferInsert> = {},
  ) {
    counter += 1;
    const created = await t.create({ orderDate: "2034-04-01" });
    await transitionOrder(t.db, owner(), created.id, "confirmed");
    if (status === "packed") {
      await transitionOrder(t.db, t.users.location_lead, created.id, "in_production");
      await transitionOrder(t.db, t.users.location_lead, created.id, "packed");
    }
    const ttn = `2045${String(counter).padStart(10, "0")}`;
    await t.db.insert(shipments).values({
      orderId: created.id,
      locationId: t.location,
      npRef: `ref-${counter}`,
      ttnNumber: ttn,
      status: shipmentStatus,
      createdInNpAt: new Date(),
      ...extra,
    });
    return { orderId: created.id, ttn };
  }
  const orderStatus = async (id: string) =>
    (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.status;
  const shipmentOf = async (orderId: string) =>
    (await t.db.select().from(shipments).where(eq(shipments.orderId, orderId)))[0]!;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  it("коди статусів Нової Пошти відповідають нашим, невідомі повертають null", () => {
    expect(["1", "12"].map(mapNpStatus)).toEqual(["created", "created"]);
    expect(["4", "5", "6", "101", "111"].map(mapNpStatus).every((s) => s === "sent")).toBe(true);
    expect(["7", "8"].map(mapNpStatus)).toEqual(["arrived", "arrived"]);
    expect(["9", "10", "11"].map(mapNpStatus).every((s) => s === "received")).toBe(true);
    expect(["102", "103"].map(mapNpStatus)).toEqual(["refused", "refused"]);
    expect(mapNpStatus("105")).toBe("returning");
    expect(mapNpStatus("106")).toBe("returned");
    expect(mapNpStatus("999")).toBeNull();
  });

  it("відправлено: статус накладної оновлюється, «Запаковано» стає «Відправлено» з приміткою, «Підтверджено» лишається", async () => {
    const packed = await shipment("packed");
    const confirmed = await shipment("confirmed");
    const result = await trackShipments(t.db, {
      api: fakeTracking({ [packed.ttn]: "5", [confirmed.ttn]: "5" }).api,
    });
    expect(result).toMatchObject({ shipped: 1 });
    expect(await shipmentOf(packed.orderId)).toMatchObject({
      status: "sent",
      statusCode: "5",
      statusText: "Статус 5",
    });
    expect(await orderStatus(packed.orderId)).toBe("shipped");
    expect(await orderStatus(confirmed.orderId)).toBe("confirmed");
    const history = await t.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, packed.orderId));
    const last = history.at(-1)!;
    expect(last).toMatchObject({ toStatus: "shipped", changedBy: null });
    expect(last.note).toContain(packed.ttn);
  });

  it("далі за маршрутом: прибуло й отримано, «Отримано» статус замовлення не міняє", async () => {
    const one = await shipment("packed");
    await trackShipments(t.db, { api: fakeTracking({ [one.ttn]: "7" }).api });
    expect(await shipmentOf(one.orderId)).toMatchObject({ status: "arrived" });
    expect(await orderStatus(one.orderId)).toBe("shipped");
    await trackShipments(t.db, { api: fakeTracking({ [one.ttn]: "9" }).api });
    expect(await shipmentOf(one.orderId)).toMatchObject({ status: "received" });
    expect(await orderStatus(one.orderId)).toBe("shipped");
    // Отримані більше не опитуємо.
    const none = fakeTracking({ [one.ttn]: "9" });
    expect((await trackShipments(t.db, { api: none.api })).checked).not.toBeGreaterThan(
      (await t.db.select().from(shipments)).length,
    );
    expect(none.sizes.reduce((a, b) => a + b, 0)).toBeLessThan(
      (await t.db.select().from(shipments)).length,
    );
  });

  it("без змін нічого не пишемо: журнал змін не росте", async () => {
    const one = await shipment("packed");
    const api = fakeTracking({ [one.ttn]: "5" }).api;
    await trackShipments(t.db, { api });
    const before = (await t.db.select().from(auditLog).where(eq(auditLog.tableName, "shipments")))
      .length;
    const again = await trackShipments(t.db, { api });
    expect(again.changed).toBe(0);
    const after = (await t.db.select().from(auditLog).where(eq(auditLog.tableName, "shipments")))
      .length;
    expect(after).toBe(before);
  });

  it("відмова й повернення: статус записано, у результаті вони позначені, статус замовлення не міняємо", async () => {
    const refused = await shipment("confirmed");
    const returning = await shipment("confirmed");
    const result = await trackShipments(t.db, {
      api: fakeTracking({ [refused.ttn]: "102", [returning.ttn]: "105" }).api,
    });
    expect(result.attention.map((a) => a.status).sort()).toEqual(["refused", "returning"]);
    expect(await orderStatus(refused.orderId)).toBe("confirmed");
    expect((await shipmentOf(refused.orderId)).status).toBe("refused");
  });

  it("накладну видалили в кабінеті (код 2): вона знову доступна для створення", async () => {
    const one = await shipment("confirmed");
    await trackShipments(t.db, { api: fakeTracking({ [one.ttn]: "2" }).api });
    expect(await shipmentOf(one.orderId)).toMatchObject({
      status: "error",
      npRef: null,
      ttnNumber: null,
    });
  });

  it("невідомий код змінює лише текст, не статус; старші за 30 днів не опитуємо", async () => {
    const odd = await shipment("confirmed");
    await trackShipments(t.db, { api: fakeTracking({ [odd.ttn]: "999" }).api });
    expect(await shipmentOf(odd.orderId)).toMatchObject({ status: "created", statusCode: "999" });
    const old = await shipment("confirmed", "created", {
      createdInNpAt: new Date(Date.now() - 31 * 86_400_000),
    });
    const probe = fakeTracking({ [old.ttn]: "7" });
    await trackShipments(t.db, { api: probe.api });
    expect((await shipmentOf(old.orderId)).status).toBe("created");
  });

  it("більше ста накладних: запити по 100 номерів", async () => {
    for (let i = 0; i < TRACKING_BATCH + 5; i += 1) await shipment("confirmed");
    const probe = fakeTracking({});
    const result = await trackShipments(t.db, { api: probe.api });
    expect(probe.sizes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...probe.sizes)).toBe(TRACKING_BATCH);
    expect(result.checked).toBe(probe.sizes.reduce((a, b) => a + b, 0));
    const status = await getTrackingStatus(t.db);
    expect(status.lastFinishedAt).not.toBeNull();
    expect(status.active).toBeGreaterThan(TRACKING_BATCH);
  }, 60_000);

  it("«Оновити статус» однієї накладної: право, локація, лише її номер у запиті", async () => {
    const one = await shipment("packed");
    const probe = fakeTracking({ [one.ttn]: "7" });
    const result = await refreshShipmentStatus(t.db, t.users.manager, one.orderId, probe.api);
    expect(probe.sizes).toEqual([1]);
    expect(result.changed).toBe(1);
    await expect(
      refreshShipmentStatus(t.db, t.users.production, one.orderId, probe.api),
    ).rejects.toThrow(ForbiddenError);
    await expect(refreshShipmentStatus(t.db, t.otherLead, one.orderId, probe.api)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("автоматичне «Відправлено» лише з «Запаковано»", async () => {
    const confirmed = await shipment("confirmed");
    expect(await markShippedBySystem(t.db, confirmed.orderId, "тест")).toBe(false);
    const packed = await shipment("packed");
    expect(await markShippedBySystem(t.db, packed.orderId, "тест")).toBe(true);
    expect(await markShippedBySystem(t.db, packed.orderId, "тест")).toBe(false);
  });
});
