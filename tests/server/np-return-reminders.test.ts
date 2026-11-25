import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { locations, profiles, reminders, settings, shipmentReturns, shipments } from "@/db/schema";
import {
  findWaitingReturns,
  generateReminders,
  listReminders,
  loadReturnReminderDays,
  RETURN_DAYS_KEY,
  sendReminders,
  setReturnReminderDays,
} from "@/server/reminders";
import { describeReminder } from "@/server/reminder-rules";
import { ForbiddenError } from "@/server/guards";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const DAY = 86_400_000;
const MORNING = new Date("2034-05-10T07:30:00Z");

describe("нагадування про посилки з боксами (B17, D226)", () => {
  let t: OrderTestContext;
  let counter = 0;
  let lvivId = "";

  async function parcel(
    daysWaiting: number,
    extra: Partial<typeof shipmentReturns.$inferInsert> = {},
  ) {
    counter += 1;
    const order = await t.create({ orderDate: "2034-04-01" });
    const [shipment] = await t.db
      .insert(shipments)
      .values({ orderId: order.id, locationId: t.location, status: "received" })
      .returning();
    await t.db.insert(shipmentReturns).values({
      shipmentId: shipment!.id,
      ttnNumber: `2047${String(counter).padStart(10, "0")}`,
      locationId: t.location,
      status: "arrived",
      arrivedAt: new Date(MORNING.getTime() - daysWaiting * DAY),
      checkedAt: MORNING,
      ...extra,
    });
  }
  const mine = async () =>
    (await t.db.select().from(reminders)).filter((r) => r.kind === "box_return_waiting");

  beforeAll(async () => {
    t = await setupOrderTests();
    lvivId = (await t.db.select().from(locations).where(eq(locations.code, "lviv")))[0]!.id;
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(reminders);
    await t.db.delete(shipmentReturns);
    await t.db.delete(shipments);
    await t.db.delete(settings).where(eq(settings.key, RETURN_DAYS_KEY));
    await t.db.update(profiles).set({ telegramUserId: null });
  });

  it("рахує лише ті, що чекають 3 дні й довше; в дорозі й забрані ні", async () => {
    await parcel(2);
    await parcel(3);
    await parcel(9, { status: "sent" });
    await parcel(9, { closedAt: MORNING });
    expect((await findWaitingReturns(t.db, MORNING)).map((w) => w.days)).toEqual([3]);
  });

  it("поріг задає власник", async () => {
    await parcel(3);
    expect(await loadReturnReminderDays(t.db)).toBe(3);
    await setReturnReminderDays(t.db, t.users.owner, 5);
    expect(await findWaitingReturns(t.db, MORNING)).toEqual([]);
    await expect(setReturnReminderDays(t.db, t.users.manager, 1)).rejects.toThrow(ForbiddenError);
    await expect(setReturnReminderDays(t.db, t.users.owner, 0)).rejects.toThrow(/від 1/);
  });

  it("одержують власник, менеджер і працівники свого міста; щодня, але не двічі за день", async () => {
    await parcel(4);
    await generateReminders(t.db, MORNING);
    await generateReminders(t.db, MORNING);
    const people = await t.db.select().from(profiles);
    const expected = people
      .filter(
        (p) =>
          p.isActive &&
          (p.role === "owner" ||
            p.role === "manager" ||
            ((p.role === "location_lead" || p.role === "production") &&
              p.locationId === t.location)),
      )
      .map((p) => p.id)
      .sort();
    expect((await mine()).map((r) => r.assigneeId).sort()).toEqual(expected);
    await generateReminders(t.db, new Date(MORNING.getTime() + DAY));
    expect(await mine()).toHaveLength(expected.length * 2);
  });

  it("чуже місто працівникам цеху не нагадує", async () => {
    await parcel(4, { locationId: lvivId });
    await generateReminders(t.db, MORNING);
    const ids = (await mine()).map((r) => r.assigneeId);
    expect(ids).toContain(t.users.owner.id);
    expect(ids).not.toContain(t.users.production.id);
    expect(ids).not.toContain(t.users.location_lead.id);
  });

  it("у Telegram: виробництву своє місто й посилання на список, власнику всі міста", async () => {
    await parcel(4);
    await parcel(6, { locationId: lvivId });
    await t.db
      .update(profiles)
      .set({ telegramUserId: 501 })
      .where(eq(profiles.id, t.users.production.id));
    await t.db
      .update(profiles)
      .set({ telegramUserId: 502 })
      .where(eq(profiles.id, t.users.owner.id));
    const ids = await generateReminders(t.db, MORNING);
    const send = vi.fn<(chat: number, text: string) => Promise<void>>(() => Promise.resolve());
    await sendReminders(t.db, ids, { now: MORNING, send });
    const textFor = (chat: number) => send.mock.calls.find(([id]) => id === chat)![1];
    expect(textFor(501)).toContain("Бокси чекають на пошті: 1 посил., найдовше 4 дн.");
    expect(textFor(501)).toContain("/boxes/returns");
    expect(textFor(501)).not.toMatch(/Львів|грн/);
    expect(textFor(502)).toContain("2 посил.");
    expect(textFor(502)).toContain("Львів 1");
  });

  it("у застосунку нагадування зникає, коли посилку забрали", async () => {
    await parcel(4);
    await generateReminders(t.db, MORNING);
    const list = async () =>
      (await listReminders(t.db, t.users.owner, MORNING)).filter(
        (r) => r.kind === "box_return_waiting",
      );
    expect(await list()).toHaveLength(1);
    await t.db.update(shipmentReturns).set({ closedAt: MORNING });
    expect(await list()).toEqual([]);
  });

  it("текст для одного й двох міст", () => {
    expect(
      describeReminder({
        kind: "box_return_waiting",
        places: [{ name: "Київ", count: 2 }],
        days: 3,
      }),
    ).toBe("Бокси чекають на пошті: 2 посил., найдовше 3 дн.");
  });
});
