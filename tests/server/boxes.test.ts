import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxEvents, boxes, boxTypes, locations, orders } from "@/db/schema";
import { listAuditEntries } from "@/server/audit";
import {
  createBoxes,
  daysAtClient,
  getBoxByCode,
  listBoxes,
  listBoxTypeOptions,
  markLabelsPrinted,
  recordBoxEvent,
} from "@/server/boxes";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import { transitionOrder } from "@/server/order-status";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("бокси: створення, події, закриття замовлення (B9, D104–D109)", () => {
  let t: OrderTestContext;
  let typeId: string;
  let otherType: string;
  let clientOwnedType: string;
  let otherLocationLead: typeof t.otherLead;

  const kyiv = () => t.location;
  const lead = () => t.users.location_lead;
  const owner = () => t.users.owner;
  const row = async (code: string) =>
    (await t.db.select().from(boxes).where(eq(boxes.code, code)))[0]!;
  const eventsOf = async (code: string) =>
    t.db
      .select()
      .from(boxEvents)
      .where(eq(boxEvents.boxId, (await row(code)).id));

  /** Замовлення «У виробництві» у локації старшого. */
  const orderInProduction = async (overrides: Parameters<typeof t.create>[0] = {}) => {
    const created = await t.create({ orderDate: "2034-01-10", ...overrides });
    await transitionOrder(t.db, t.users.owner, created.id, "confirmed");
    await transitionOrder(t.db, lead(), created.id, "in_production");
    return created.id;
  };
  const batch = async (count = 3, actor = owner(), locationId = kyiv()) =>
    (await createBoxes(t.db, actor, { boxTypeId: typeId, locationId, count })).codes;

  beforeAll(async () => {
    t = await setupOrderTests();
    const types = await t.db.select().from(boxTypes);
    typeId = types.find((x) => !x.isClientOwned)!.id;
    otherType = types.filter((x) => !x.isClientOwned)[1]!.id;
    clientOwnedType = types.find((x) => x.isClientOwned)!.id;
    otherLocationLead = t.otherLead;
    await t.db.update(locations).set({ boxPrefix: "T" }).where(eq(locations.id, t.location));
    await t.db.update(locations).set({ boxPrefix: "U" }).where(eq(locations.id, t.otherLocation));
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  describe("створення партії", () => {
    it("коди без дір, номер продовжується, події «створено» записані", async () => {
      const first = await batch(3);
      expect(first).toEqual(["T-0001", "T-0002", "T-0003"]);
      const second = await batch(2);
      expect(second).toEqual(["T-0004", "T-0005"]);
      expect(await row("T-0004")).toMatchObject({ status: "in_stock", currentClientId: null });
      const events = await eventsOf("T-0001");
      expect(events.map((e) => e.event)).toEqual(["created"]);
      expect(events[0]!.actorId).toBe(owner().id);
    });

    it("в іншої локації свій префікс і свій відлік", async () => {
      const codes = await batch(2, owner(), t.otherLocation);
      expect(codes).toEqual(["U-0001", "U-0002"]);
    });

    it("дві партії одночасно не дають однакових кодів", async () => {
      const [a, b] = await Promise.all([batch(4), batch(4)]);
      const all = [...a, ...b];
      expect(new Set(all).size).toBe(8);
    });

    it("кількість від 1 до 500, тип активний і не «бокс клієнта», у локації є префікс", async () => {
      for (const count of [0, -1, 501, 1.5]) {
        await expect(batch(count), String(count)).rejects.toBeInstanceOf(ValidationError);
      }
      await expect(
        createBoxes(t.db, owner(), { boxTypeId: clientOwnedType, locationId: kyiv(), count: 1 }),
      ).rejects.toThrow(/клієнтів/);
      const [noPrefix] = await t.db
        .insert(locations)
        .values({ code: "nopref", name: "Без префікса" })
        .returning();
      await expect(
        createBoxes(t.db, owner(), { boxTypeId: typeId, locationId: noPrefix!.id, count: 1 }),
      ).rejects.toThrow(/префікс/);
    });

    it("створюють власник і старший локації своєї локації; решта й чужа локація ні", async () => {
      await expect(batch(1, lead())).resolves.toHaveLength(1);
      await expect(batch(1, lead(), t.otherLocation)).rejects.toBeInstanceOf(ForbiddenError);
      for (const role of ["manager", "production", "accountant", "driver"] as const) {
        await expect(batch(1, t.users[role]), role).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("«надруковано»: час і подія, права як у реєстру", async () => {
      const [code] = await batch(1);
      await expect(markLabelsPrinted(t.db, lead(), [code!])).resolves.toEqual({ count: 1 });
      expect((await row(code!)).labelPrintedAt).toBeInstanceOf(Date);
      expect((await eventsOf(code!)).map((e) => e.event)).toContain("label_printed");
      await expect(markLabelsPrinted(t.db, t.users.manager, [code!])).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(markLabelsPrinted(t.db, owner(), ["X-9999"])).rejects.toThrow(/не знайдено/);
      await expect(markLabelsPrinted(t.db, owner(), [])).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("видача й повернення", () => {
    it("видача в замовлення: бокс у клієнта з датою, подія з клієнтом і замовленням (критерій 1 ТЗ)", async () => {
      const [a, b] = await batch(2);
      const orderId = await orderInProduction();
      const r1 = await recordBoxEvent(t.db, lead(), { code: a!, action: "issue", orderId });
      expect(r1).toMatchObject({ code: a, status: "ok", boxStatus: "at_client", duplicate: false });
      await recordBoxEvent(t.db, t.users.production, { code: b!, action: "issue", orderId });
      const box = await row(a!);
      expect(box).toMatchObject({
        status: "at_client",
        currentClientId: t.client.id,
        currentOrderId: orderId,
      });
      expect(box.issuedAt).toBeInstanceOf(Date);
      const issued = (await eventsOf(a!)).find((e) => e.event === "issued")!;
      expect(issued).toMatchObject({ orderId, clientId: t.client.id, actorId: lead().id });
    });

    it("код з адреси QR і малі літери приймаються", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      const r = await recordBoxEvent(t.db, lead(), {
        code: `https://crm.example.com/b/${code!.toLowerCase()}`,
        action: "issue",
        orderId,
      });
      expect(r.code).toBe(code);
    });

    it("видають лише до «У виробництві» чи «Запаковано», і лише у своїй локації", async () => {
      const [code] = await batch(1);
      const draft = (await t.create({ orderDate: "2034-01-11" })).id;
      await expect(
        recordBoxEvent(t.db, owner(), { code: code!, action: "issue", orderId: draft }),
      ).rejects.toThrow(/У виробництві/);
      const orderId = await orderInProduction();
      await expect(
        recordBoxEvent(t.db, otherLocationLead, { code: code!, action: "issue", orderId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordBoxEvent(t.db, lead(), { code: code!, action: "issue" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("власник, менеджер, бухгалтер і водій: менеджер, бухгалтер, водій не сканують", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      for (const role of USER_ROLES) {
        if (["owner", "location_lead", "production"].includes(role)) continue;
        await expect(
          recordBoxEvent(t.db, t.users[role], { code: code!, action: "issue", orderId }),
          role,
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("той самий бокс у те саме замовлення двічі: помилка; невідомий код: «Бокс не знайдено»", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      await expect(
        recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId }),
      ).rejects.toThrow("Бокс уже у цьому замовленні.");
      await expect(
        recordBoxEvent(t.db, lead(), { code: "T-9999", action: "return" }),
      ).rejects.toThrow("Бокс не знайдено.");
      await expect(
        recordBoxEvent(t.db, lead(), { code: "сміття", action: "return" }),
      ).rejects.toThrow("Некоректний код бокса.");
    });

    it("бокс іншого клієнта: попередження, повернення від попереднього записане автоматично", async () => {
      const [code] = await batch(1);
      const first = await orderInProduction();
      const other = await t.db
        .insert((await import("@/db/schema")).clients)
        .values({ code: "АА9901", name: "Інший клієнт" })
        .returning();
      const second = await orderInProduction({ clientId: other[0]!.id });
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId: first });
      const r = await recordBoxEvent(t.db, lead(), {
        code: code!,
        action: "issue",
        orderId: second,
      });
      expect(r.status).toBe("warning");
      expect(r.message).toContain("іншого клієнта");
      expect(await row(code!)).toMatchObject({
        currentClientId: other[0]!.id,
        currentOrderId: second,
      });
      const events = (await eventsOf(code!)).map((e) => e.event).sort();
      expect(events).toEqual(["created", "issued", "issued", "returned"].sort());
      const returned = (await eventsOf(code!)).find((e) => e.event === "returned")!;
      expect(returned).toMatchObject({ clientId: t.client.id, orderId: first });
    });

    it("повернення: на складі, рядок «Повернено від … був N дн.», повторний скан лише примітка (критерій 2 ТЗ)", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      const back = await recordBoxEvent(t.db, lead(), { code: code!, action: "return" });
      expect(back).toMatchObject({ status: "ok", boxStatus: "in_stock" });
      expect(back.message).toBe("Повернено від Кафе Тест, був 0 дн.");
      expect(await row(code!)).toMatchObject({
        status: "in_stock",
        currentClientId: null,
        currentOrderId: null,
      });

      const again = await recordBoxEvent(t.db, lead(), { code: code!, action: "return" });
      expect(again.status).toBe("warning");
      const kinds = (await eventsOf(code!)).map((e) => e.event);
      expect(kinds.filter((k) => k === "returned")).toHaveLength(1);
      expect((await eventsOf(code!)).find((e) => e.event === "note")!.note).toBe("повторний скан");
    });

    it("дні в клієнта рахуються за київськими днями", () => {
      const issued = new Date("2034-01-10T22:30:00Z"); // 11.01 00:30 за Києвом
      expect(daysAtClient(issued, new Date("2034-01-12T10:00:00Z"))).toBe(1);
      expect(daysAtClient(issued, new Date("2034-01-11T10:00:00Z"))).toBe(0);
      expect(daysAtClient(issued, new Date("2034-01-01T10:00:00Z"))).toBe(0);
    });
  });

  describe("повторна відправка без дублів (D112)", () => {
    it("той самий номер скана записується один раз і повертає «уже записано»", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      const first = await recordBoxEvent(t.db, lead(), {
        code: code!,
        action: "issue",
        orderId,
        deviceQueueId: "q-1",
      });
      const second = await recordBoxEvent(t.db, lead(), {
        code: code!,
        action: "issue",
        orderId,
        deviceQueueId: "q-1",
      });
      expect(first.duplicate).toBe(false);
      expect(second).toMatchObject({ duplicate: true, code });
      expect((await eventsOf(code!)).filter((e) => e.event === "issued")).toHaveLength(1);
    });

    it("час скана з телефона зберігається, а збитий годинник відхиляється", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      const at = new Date(Date.now() - 3600_000).toISOString();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId, occurredAt: at });
      const issued = (await eventsOf(code!)).find((e) => e.event === "issued")!;
      expect(issued.occurredAt.toISOString()).toBe(at);
      expect(issued.recordedAt.getTime()).toBeGreaterThan(issued.occurredAt.getTime());
      const [other] = await batch(1);
      for (const bad of [
        "не час",
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        "2001-01-01T00:00:00Z",
      ]) {
        await expect(
          recordBoxEvent(t.db, lead(), { code: other!, action: "return", occurredAt: bad }),
          bad,
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });
  });

  describe("закриття замовлення (D109)", () => {
    it("оплачене замовлення з бокс у клієнта не закривається, а повернення останнього закриває", async () => {
      const [a, b] = await batch(2);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: a!, action: "issue", orderId });
      await recordBoxEvent(t.db, lead(), { code: b!, action: "issue", orderId });
      await transitionOrder(t.db, lead(), orderId, "packed");
      await transitionOrder(t.db, lead(), orderId, "shipped");
      await transitionOrder(t.db, owner(), orderId, "paid", { note: "Оплата" });
      expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
        "paid",
      );

      await recordBoxEvent(t.db, lead(), { code: a!, action: "return" });
      expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
        "paid",
      );
      await recordBoxEvent(t.db, lead(), { code: b!, action: "return" });
      const closed = (await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!;
      expect(closed.status).toBe("closed");
      expect(closed.closedAt).toBeInstanceOf(Date);
    });

    it("замовлення без сканів закривається одразу після оплати, як і раніше", async () => {
      const orderId = await orderInProduction();
      await transitionOrder(t.db, lead(), orderId, "packed");
      await transitionOrder(t.db, lead(), orderId, "shipped");
      await transitionOrder(t.db, owner(), orderId, "paid", { note: "Оплата" });
      expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
        "closed",
      );
    });

    it("продаж бокса знімає борг: оплачене замовлення закривається", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      await transitionOrder(t.db, lead(), orderId, "packed");
      await transitionOrder(t.db, lead(), orderId, "shipped");
      await transitionOrder(t.db, owner(), orderId, "paid", { note: "Оплата" });
      await recordBoxEvent(t.db, lead(), { code: code!, action: "sell", orderId });
      expect((await row(code!)).status).toBe("sold");
      expect((await t.db.select().from(orders).where(eq(orders.id, orderId)))[0]!.status).toBe(
        "closed",
      );
    });
  });

  describe("продаж, втрата, знайдено, списання, переміщення", () => {
    it("продаж: власник і старший локації; проданий бокс більше не видати й не повернути", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "sell", orderId });
      expect(await row(code!)).toMatchObject({ status: "sold", currentClientId: null });
      await expect(
        recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId }),
      ).rejects.toThrow(/проданий/);
      await expect(
        recordBoxEvent(t.db, lead(), { code: code!, action: "return" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const [other] = await batch(1);
      await expect(
        recordBoxEvent(t.db, t.users.production, { code: other!, action: "sell", orderId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("втрата й списання лише власник; «знайдено» повертає на склад", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      await expect(
        recordBoxEvent(t.db, lead(), { code: code!, action: "lose" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await recordBoxEvent(t.db, owner(), {
        code: code!,
        action: "lose",
        note: "Клієнт не повертає",
      });
      expect(await row(code!)).toMatchObject({ status: "lost", currentClientId: null });
      await recordBoxEvent(t.db, lead(), { code: code!, action: "find" });
      expect((await row(code!)).status).toBe("in_stock");
      await recordBoxEvent(t.db, owner(), { code: code!, action: "retire", note: "Тріснув" });
      expect(await row(code!)).toMatchObject({ status: "retired", retireReason: "Тріснув" });
      expect((await row(code!)).retiredAt).toBeInstanceOf(Date);
      await expect(
        recordBoxEvent(t.db, owner(), { code: code!, action: "find" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("переміщення в іншу локацію: власник, лише зі складу, подія «переміщено»", async () => {
      const [code] = await batch(1);
      await expect(
        recordBoxEvent(t.db, lead(), {
          code: code!,
          action: "transfer",
          toLocationId: t.otherLocation,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordBoxEvent(t.db, owner(), { code: code!, action: "transfer", toLocationId: kyiv() }),
      ).rejects.toThrow(/уже в цій локації/);
      await recordBoxEvent(t.db, owner(), {
        code: code!,
        action: "transfer",
        toLocationId: t.otherLocation,
      });
      expect((await row(code!)).locationId).toBe(t.otherLocation);
      expect((await eventsOf(code!)).map((e) => e.event)).toContain("transferred");
    });
  });

  describe("картка бокса й журнал змін", () => {
    it("картка з історією: нові події першими, клієнт і номер замовлення, права", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      const card = (await getBoxByCode(t.db, lead(), code!))!;
      expect(card).toMatchObject({
        code,
        status: "at_client",
        statusLabel: "У клієнта",
        clientName: "Кафе Тест",
        locationName: expect.any(String),
      });
      expect(card.history.map((h) => h.event)).toEqual(["issued", "created"]);
      expect(card.history[0]).toMatchObject({
        clientName: "Кафе Тест",
        actorName: lead().fullName,
      });
      expect(await getBoxByCode(t.db, lead(), "T-9999")).toBeNull();
      for (const role of ["manager", "accountant", "driver"] as const) {
        await expect(getBoxByCode(t.db, t.users[role], code!), role).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });

    it("власник бачить зміни боксів у журналі словами: «Бокс T-…», розділ «Бокси»", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      const page = await listAuditEntries(t.db, owner(), { section: "boxes" });
      const mine = page.items.filter((i) => i.subject === `Бокс ${code}`);
      expect(mine.length).toBeGreaterThanOrEqual(3);
      expect(mine.every((i) => i.sectionLabel === "Бокси")).toBe(true);
      const update = mine.find((i) =>
        i.changes.some((c) => c.label === "Статус" && c.after === "У клієнта"),
      );
      expect(update).toBeDefined();
    });
  });

  describe("реєстр: список і фільтри", () => {
    it("власник бачить усі локації, старший лише свою; нові коди першими", async () => {
      await batch(2);
      await batch(1, owner(), t.otherLocation);
      const all = await listBoxes(t.db, owner(), { limit: 300 });
      expect(new Set(all.items.map((i) => i.locationName)).size).toBeGreaterThan(1);
      const mine = await listBoxes(t.db, lead(), { limit: 300 });
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.every((i) => i.code.startsWith("T-"))).toBe(true);
      // Усередині локації новіші створені коди йдуть раніше.
      const codes = mine.items.map((i) => i.code);
      expect(codes.indexOf(codes.at(0)!)).toBe(0);
      const one = await listBoxes(t.db, owner(), { locationId: t.otherLocation, limit: 300 });
      // Переміщений бокс зберігає старий код, але стоїть у новій локації.
      expect(new Set(one.items.map((i) => i.locationName)).size).toBe(1);
      expect(one.items.some((i) => i.code.startsWith("U-"))).toBe(true);
    });

    it("фільтри за статусом, типом і кодом; сторінки з «ще»", async () => {
      const [code] = await batch(1);
      const orderId = await orderInProduction();
      await recordBoxEvent(t.db, lead(), { code: code!, action: "issue", orderId });
      const atClient = await listBoxes(t.db, owner(), { status: "at_client", limit: 300 });
      expect(atClient.items.map((i) => i.code)).toContain(code);
      expect(atClient.items.find((i) => i.code === code)).toMatchObject({
        statusLabel: "У клієнта",
        clientName: "Кафе Тест",
      });
      expect((await listBoxes(t.db, owner(), { search: code!.toLowerCase() })).items).toHaveLength(
        1,
      );
      expect((await listBoxes(t.db, owner(), { search: "%" })).items.length).toBeGreaterThan(0);
      expect((await listBoxes(t.db, owner(), { boxTypeId: otherType })).items).toHaveLength(0);
      const page = await listBoxes(t.db, owner(), { limit: 2 });
      expect(page).toMatchObject({ hasMore: true });
      expect(page.items).toHaveLength(2);
    });

    it("реєстр бачать лише власник і старший локації; типи для створення без «боксу клієнта»", async () => {
      for (const role of ["manager", "production", "accountant", "driver"] as const) {
        await expect(listBoxes(t.db, t.users[role]), role).rejects.toBeInstanceOf(ForbiddenError);
      }
      const types = await listBoxTypeOptions(t.db);
      expect(types.map((x) => x.id)).not.toContain(clientOwnedType);
      expect(types.length).toBeGreaterThan(1);
    });
  });

  it("другий тип тари існує для тестів (страховка фікстури)", () => {
    expect(otherType).not.toBe(typeId);
  });
});
