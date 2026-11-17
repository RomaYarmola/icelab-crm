import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxTypes, clientAddresses, shipments } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { listShipmentDay } from "@/server/np/shipment-day";
import { saveLocationSender } from "@/server/np/settings";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const DAY = "2034-03-05";

describe("«ТТН на день» (B10, PR 4)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  let ready: string;
  let unresolved: string;
  let withTtn: string;
  let pickup: string;
  let draft: string;
  let boxType: string;

  const np = (overrides: Parameters<typeof t.create>[0] = {}) =>
    t.create({
      orderDate: DAY,
      deliveryMethod: "np",
      recipientName: "Коваль Олена",
      recipientPhone: "+380501234567",
      boxTypeId: boxType,
      boxCount: 2,
      ...overrides,
    });
  const address = async (values: Partial<typeof clientAddresses.$inferInsert> = {}) =>
    (
      await t.db
        .insert(clientAddresses)
        .values({
          clientId: t.client.id,
          kind: "np_warehouse",
          cityText: "Київ",
          npCityRef: "c",
          npWarehouseRef: "w",
          npWarehouseNumber: "5",
          isResolved: true,
          ...values,
        })
        .returning()
    )[0]!;

  beforeAll(async () => {
    t = await setupOrderTests();
    await saveLocationSender(t.db, owner(), {
      locationId: t.location,
      senderRef: "s",
      contactRef: "c",
      addressRef: "a",
      cityRef: "city",
      phone: "+380441112233",
    });
    boxType = (await t.db.select().from(boxTypes)).find((x) => !x.isClientOwned)!.id;
    const good = await address();
    const bad = await address({ isResolved: false, npWarehouseRef: null });
    ready = (await np({ addressId: good.id })).id;
    unresolved = (await np({ addressId: bad.id })).id;
    withTtn = (await np({ addressId: good.id })).id;
    pickup = (await t.create({ orderDate: DAY, deliveryMethod: "pickup" })).id;
    draft = (await np({ addressId: good.id })).id;
    for (const id of [ready, unresolved, withTtn, pickup]) {
      await transitionOrder(t.db, owner(), id, "confirmed");
    }
    await t.db.insert(shipments).values({
      orderId: withTtn,
      locationId: t.location,
      npRef: "ref",
      ttnNumber: "20450000000009",
      status: "created",
    });
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const row = (rows: Awaited<ReturnType<typeof listShipmentDay>>["rows"], id: string) =>
    rows.find((r) => r.orderId === id);

  it("список дня: лише замовлення Нової Пошти, без чернеток і самовивозу", async () => {
    const { rows } = await listShipmentDay(t.db, t.users.manager, { date: DAY });
    expect(row(rows, ready)).toBeDefined();
    expect(row(rows, unresolved)).toBeDefined();
    expect(row(rows, withTtn)).toBeDefined();
    expect(row(rows, pickup)).toBeUndefined();
    expect(row(rows, draft)).toBeUndefined();
    expect((await listShipmentDay(t.db, owner(), { date: "2034-03-06" })).rows).toEqual([]);
  });

  it("готове замовлення можна вибрати, неуточнена адреса й накладна вже створена ні", async () => {
    const { rows } = await listShipmentDay(t.db, owner(), { date: DAY });
    expect(row(rows, ready)).toMatchObject({ selectable: true, blockers: [], seats: 2 });
    expect(row(rows, unresolved)).toMatchObject({ selectable: false, needsAddress: true });
    expect(row(rows, unresolved)!.blockers.join(" ")).toContain("уточнення");
    expect(row(rows, withTtn)).toMatchObject({
      selectable: false,
      blockers: [],
      shipment: { ttnNumber: "20450000000009", statusLabel: "Створена" },
    });
  });

  it("накладна з помилкою лишається доступною для повторного створення", async () => {
    await t.db.insert(shipments).values({
      orderId: ready,
      locationId: t.location,
      status: "error",
      errorText: "Помилка Нової Пошти",
    });
    const { rows } = await listShipmentDay(t.db, owner(), { date: DAY });
    expect(row(rows, ready)).toMatchObject({
      selectable: true,
      shipment: { status: "error", errorText: "Помилка Нової Пошти" },
    });
    await t.db.delete(shipments).where(eq(shipments.orderId, ready));
  });

  it("локація: старший бачить свою, чужої не бачить, власник звужує вибором", async () => {
    const lead = await listShipmentDay(t.db, t.users.location_lead, { date: DAY });
    expect(lead.rows.length).toBeGreaterThan(0);
    expect((await listShipmentDay(t.db, t.otherLead, { date: DAY })).rows).toEqual([]);
    expect(
      (await listShipmentDay(t.db, owner(), { date: DAY, locationId: t.otherLocation })).rows,
    ).toEqual([]);
    // Старший не може підмінити локацію параметром.
    expect(
      (await listShipmentDay(t.db, t.otherLead, { date: DAY, locationId: t.location })).rows,
    ).toEqual([]);
  });

  it("право: власник, менеджер і старший локації; цех, бухгалтер і водій ні; суми у відповіді немає", async () => {
    for (const role of USER_ROLES) {
      const call = listShipmentDay(t.db, t.users[role], { date: DAY });
      if (role === "owner" || role === "manager" || role === "location_lead") {
        const result = await call;
        expect(JSON.stringify(result), role).not.toMatch(/total|price|1800/i);
      } else {
        await expect(call, role).rejects.toThrow(ForbiddenError);
      }
    }
  });

  it("некоректна дата відхиляється", async () => {
    await expect(listShipmentDay(t.db, owner(), { date: "вчора" })).rejects.toThrow("Вкажіть дату");
  });
});
