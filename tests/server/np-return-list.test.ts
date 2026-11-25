import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  boxes,
  boxTypes,
  locations,
  orderBoxes,
  orders,
  shipmentReturns,
  shipments,
} from "@/db/schema";
import { listPostReturns } from "@/server/np/return-list";
import { ForbiddenError } from "@/server/guards";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const NOW = new Date("2034-05-10T08:00:00Z");

describe("«Чекають на пошті» (B17, фаза 2)", () => {
  let t: OrderTestContext;
  let counter = 0;
  let lvivId = "";
  let homeName = "";
  let boxType: typeof boxTypes.$inferSelect;

  async function postReturn(extra: Partial<typeof shipmentReturns.$inferInsert> = {}) {
    counter += 1;
    const order = await t.create({ orderDate: "2034-04-01" });
    const [shipment] = await t.db
      .insert(shipments)
      .values({
        orderId: order.id,
        locationId: t.location,
        ttnNumber: `2045${String(counter).padStart(10, "0")}`,
        status: "received",
      })
      .returning();
    await t.db.insert(shipmentReturns).values({
      shipmentId: shipment!.id,
      ttnNumber: `2046${String(counter).padStart(10, "0")}`,
      locationId: t.location,
      status: "arrived",
      arrivedAt: new Date("2034-05-08T08:00:00Z"),
      paidStorageFrom: new Date("2034-05-15T08:00:00Z"),
      checkedAt: NOW,
      ...extra,
    });
    return order;
  }

  beforeAll(async () => {
    t = await setupOrderTests();
    lvivId = (await t.db.select().from(locations).where(eq(locations.code, "lviv")))[0]!.id;
    boxType = (await t.db.select().from(boxTypes))[0]!;
    homeName = (await t.db.select().from(locations).where(eq(locations.id, t.location)))[0]!.name;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(boxes);
    await t.db.delete(shipmentReturns);
    await t.db.delete(shipments);
  });

  it("групує по містах; спершу ті, що чекають, з найближчим платним зберіганням", async () => {
    const later = await postReturn();
    const urgent = await postReturn({
      paidStorageFrom: new Date("2034-05-11T08:00:00Z"),
      arrivedAt: new Date("2034-05-04T08:00:00Z"),
    });
    const moving = await postReturn({ status: "sent", arrivedAt: null, paidStorageFrom: null });
    const fresh = await postReturn({ status: "created", arrivedAt: null, paidStorageFrom: null });
    const lviv = await postReturn({ locationId: lvivId });

    const groups = await listPostReturns(t.db, t.users.owner, { now: NOW });
    expect(groups.map((g) => g.locationName)).toEqual([homeName, "Львів"]);
    expect(groups[0]!.items.map((i) => i.orderNumber)).toEqual([
      urgent.number,
      later.number,
      moving.number,
      fresh.number,
    ]);
    expect(groups[0]!.items.map((i) => i.state)).toEqual([
      "waiting",
      "waiting",
      "transit",
      "registered",
    ]);
    expect(groups[0]!.items[0]).toMatchObject({
      waitingDays: 6,
      paidStorageDay: "2034-05-11",
      urgent: true,
    });
    expect(groups[0]!.items[1]).toMatchObject({ waitingDays: 2, urgent: false });
    expect(groups[0]!.items[2]).toMatchObject({ waitingDays: null, urgent: false });
    expect(groups[1]!.items.map((i) => i.orderNumber)).toEqual([lviv.number]);
  });

  it("не показує закриті й відправки без повернення", async () => {
    await postReturn({ closedAt: NOW });
    await postReturn({ ttnNumber: null, status: null });
    expect(await listPostReturns(t.db, t.users.owner, { now: NOW })).toEqual([]);
  });

  it("тара: видані й ще не повернені бокси, а без наклейок тара замовлення", async () => {
    const labelled = await postReturn();
    const plain = await postReturn();
    const clientId = (await t.db.select().from(orders).where(eq(orders.id, labelled.id)))[0]!
      .clientId;
    await t.db.insert(boxes).values(
      ["K-9001", "K-9002"].map((code) => ({
        code,
        boxTypeId: boxType.id,
        locationId: t.location,
        status: "at_client" as const,
        currentClientId: clientId,
        currentOrderId: labelled.id,
        issuedAt: NOW,
      })),
    );
    await t.db.delete(orderBoxes).where(eq(orderBoxes.orderId, plain.id));
    await t.db.insert(orderBoxes).values({ orderId: plain.id, boxTypeId: boxType.id, count: 3 });

    const items = (await listPostReturns(t.db, t.users.owner, { now: NOW }))[0]!.items;
    const of = (n: number) => items.find((i) => i.orderNumber === n)!;
    expect(of(labelled.number!)).toMatchObject({
      boxCodes: ["K-9001", "K-9002"],
      boxSummary: `${boxType.name} × 2`,
    });
    expect(of(plain.number!)).toMatchObject({
      boxCodes: [],
      boxSummary: `${boxType.name} × 3`,
    });
  });

  it("власник звужує вибором локації; старший локації й виробництво бачать лише своє місто", async () => {
    await postReturn();
    await postReturn({ locationId: lvivId });
    const names = async (user: keyof OrderTestContext["users"], locationId?: string) =>
      (await listPostReturns(t.db, t.users[user], { now: NOW, locationId })).map(
        (g) => g.locationName,
      );
    expect(await names("owner", lvivId)).toEqual(["Львів"]);
    expect(await names("manager")).toEqual([homeName, "Львів"]);
    expect(await names("accountant")).toEqual([homeName, "Львів"]);
    expect(await names("location_lead", lvivId)).toEqual([homeName]);
    expect(await names("production")).toEqual([homeName]);
  });

  it("водій не бачить, а в даних немає грошей", async () => {
    await postReturn();
    await expect(listPostReturns(t.db, { ...t.users.production, role: "driver" })).rejects.toThrow(
      ForbiddenError,
    );
    const data = await listPostReturns(t.db, t.users.production, { now: NOW });
    expect(JSON.stringify(data)).not.toMatch(/"(?:price|amount|total|cost|costUah|sum|paid)"/i);
  });
});
