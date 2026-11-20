import { eq } from "drizzle-orm";
import { LOCATION_PENDING_NOTE, REPEAT_CONTACT_NOTE } from "@/constants/intake";
import { updateOrder } from "@/server/orders";
import { transitionOrder } from "@/server/order-status";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/site/route";
import { clientContacts, clients, orders, profiles, siteLeads } from "@/db/schema";
import {
  dedupeKey,
  locationFromText,
  methodFromText,
  npKindFromText,
  isConsultation,
  receiveSiteLead,
  summarizeItems,
} from "@/server/intake/site-lead";
import { isSiteRequest, LEAD_SECRET_HEADER } from "@/server/intake/site-auth";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const NOW = new Date("2034-08-10T09:00:00Z");

const lead = (overrides: Record<string, unknown> = {}) => ({
  lead: {
    type: "замовлення",
    name: "Коваль Олена",
    phone: "050 123 45 67",
    messenger: "Viber",
    delivery: "Самовивіз зі складу у Києві",
    comment: "Подзвоніть заздалегідь",
    items: [{ title: "Гранули 16 мм", quantity: 40, unit: "кг", price: 75 }],
    ...overrides,
  },
  message: "Нова заявка з сайту",
  receivedAt: NOW.toISOString(),
});

describe("заявки з сайту (B11, PR 4)", () => {
  let t: OrderTestContext;
  let phoneCounter = 0;
  const uniquePhone = () => `+38067${String((phoneCounter += 1)).padStart(7, "0")}`;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(siteLeads);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("допоміжні: спосіб отримання, локація, позиції, ключ дубліката", () => {
    expect(methodFromText("Самовивіз зі складу")).toBe("pickup");
    expect(methodFromText("Нова пошта, відділення 5")).toBe("np");
    // Власна доставка за адресою; автобус і невідоме дають null, менеджер обирає вручну.
    expect(methodFromText("Доставка кур'єром")).toBe("our_delivery");
    expect(methodFromText("автобус")).toBeNull();
    expect(methodFromText("не знаю")).toBeNull();
    expect(npKindFromText("Нова пошта, відділення 5")).toBe("warehouse");
    expect(npKindFromText("Нова пошта, кур'єром на адресу")).toBe("courier");
    expect(methodFromText(undefined)).toBeNull();
    expect(locationFromText("Самовивіз зі складу у Львові")).toBe("lviv");
    expect(locationFromText("Доставка")).toBe("kyiv");
    expect(
      summarizeItems([
        { title: "Гранули 16мм", quantity: "20,5", unit: "кг" },
        { title: "Гранули 16 мм", quantity: 10, unit: "кг" },
        { title: "Бокс 46 л", quantity: 2, unit: "шт" },
      ]),
    ).toEqual({
      kg: 30.5,
      ice: "16mm",
      rest: ["Бокс 46 л × 2 шт"],
    });
    // Другий тип льоду не змішуємо з першим: він іде в коментар.
    const mixed = summarizeItems([
      { title: "3 мм", quantity: 10, unit: "кг" },
      { title: "19 мм", quantity: 5, unit: "кг" },
    ]);
    expect(mixed).toMatchObject({ kg: 10, ice: "3mm" });
    expect(mixed.rest[0]).toContain("19 мм");
    const a = dedupeKey("+380501234567", new Date("2034-08-10T09:01:00Z"));
    expect(dedupeKey("+380501234567", new Date("2034-08-10T09:09:00Z"))).toBe(a);
    expect(dedupeKey("+380501234567", new Date("2034-08-10T09:11:00Z"))).not.toBe(a);
    expect(dedupeKey("+380509999999", new Date("2034-08-10T09:01:00Z"))).not.toBe(a);
  });

  it("секрет сайту: без налаштованого, без заголовка й з чужим доступу немає", () => {
    const req = (secret?: string) =>
      new Request("http://x/api/leads/site", {
        method: "POST",
        headers: secret ? { [LEAD_SECRET_HEADER]: secret } : {},
      });
    vi.stubEnv("LEAD_SITE_SECRET", "");
    expect(isSiteRequest(req("anything"))).toBe(false);
    vi.stubEnv("LEAD_SITE_SECRET", "right-secret");
    expect(isSiteRequest(req())).toBe(false);
    expect(isSiteRequest(req("other-secret-xx"))).toBe(false);
    expect(isSiteRequest(req("right-secret"))).toBe(true);
  });

  it("приймач: 401 без секрету, 400 для не JSON, 422 для поганого телефону, нічого не пишеться", async () => {
    vi.stubEnv("LEAD_SITE_SECRET", "right-secret");
    const post = (body: string, secret?: string) =>
      POST(
        new Request("http://x/api/leads/site", {
          method: "POST",
          headers: secret ? { [LEAD_SECRET_HEADER]: secret } : {},
          body,
        }),
      );
    expect((await post("{}")).status).toBe(401);
    expect((await post("{}", "wrong-secret")).status).toBe(401);
    expect((await post("не json", "right-secret")).status).toBe(400);
    expect((await post(JSON.stringify({ lead: {} }), "right-secret")).status).toBe(400);
    expect(await t.db.select().from(siteLeads)).toHaveLength(0);
  });

  it("заявка стає чернеткою із сайту: джерело, лід і кілограми, коментар, одержувач, клієнт «Новий клієнт», нового клієнта не створено", async () => {
    const real = (await t.db.select().from(clients)).filter((c) => !c.isPlaceholder).length;
    const result = await receiveSiteLead(t.db, lead({ phone: uniquePhone() }), { now: NOW });
    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) return;
    const [order] = await t.db.select().from(orders).where(eq(orders.id, result.draftId));
    expect(order).toMatchObject({
      status: "draft",
      kgSold: "40.000",
      deliveryMethod: "pickup",
      recipientName: "Коваль Олена",
    });
    expect(order!.comment).toContain("Подзвоніть заздалегідь");
    expect(order!.comment).toContain("Месенджер: Viber");
    expect(order!.draftPayload).toMatchObject({ source: "site", isPlaceholder: true });
    expect(order!.iceTypeId).not.toBeNull();
    expect(order!.sourceId).not.toBeNull();
    const [owner] = await t.db.select().from(profiles).where(eq(profiles.id, order!.createdBy!));
    expect(owner!.role).toBe("owner");
    // Справжні клієнти не створюються (лише службовий «Новий клієнт»).
    expect((await t.db.select().from(clients)).filter((c) => !c.isPlaceholder)).toHaveLength(real);
    const [saved] = await t.db.select().from(siteLeads);
    expect(saved).toMatchObject({ orderId: result.draftId });
  });

  it("клієнт за телефоном: один збіг підставляється, кілька чи жодного дають «Новий клієнт»", async () => {
    const known = uniquePhone();
    await t.db
      .insert(clientContacts)
      .values({ clientId: t.client.id, name: "Олена", phone: known });
    const found = await receiveSiteLead(t.db, lead({ phone: known }), { now: NOW });
    if (!found.ok) throw new Error("очікувався успіх");
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, found.draftId)))[0]!.clientId,
    ).toBe(t.client.id);
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, found.draftId)))[0]!.draftPayload,
    ).toMatchObject({ isPlaceholder: false });

    const shared = uniquePhone();
    const [other] = await t.db.insert(clients).values({ code: "АА955", name: "Інший" }).returning();
    await t.db.insert(clientContacts).values([
      { clientId: t.client.id, name: "А", phone: shared },
      { clientId: other!.id, name: "Б", phone: shared },
    ]);
    const ambiguous = await receiveSiteLead(t.db, lead({ phone: shared }), { now: NOW });
    if (!ambiguous.ok) throw new Error("очікувався успіх");
    expect(
      (await t.db.select().from(orders).where(eq(orders.id, ambiguous.draftId)))[0]!.draftPayload,
    ).toMatchObject({ isPlaceholder: true });
  });

  it("львівський склад дає чернетку для Львова, доставка Нова Пошта з текстом", async () => {
    const lviv = await receiveSiteLead(
      t.db,
      lead({ phone: uniquePhone(), delivery: "Самовивіз зі складу у Львові" }),
      { now: NOW },
    );
    const np = await receiveSiteLead(
      t.db,
      lead({ phone: uniquePhone(), delivery: "Нова пошта, Одеса, відділення 4" }),
      { now: NOW },
    );
    if (!lviv.ok || !np.ok) throw new Error("очікувався успіх");
    const [a] = await t.db.select().from(orders).where(eq(orders.id, lviv.draftId));
    const [b] = await t.db.select().from(orders).where(eq(orders.id, np.draftId));
    expect(a!.locationId).not.toBe(b!.locationId);
    expect(b).toMatchObject({
      deliveryMethod: "np",
      deliveryText: "Нова пошта, Одеса, відділення 4",
    });
  });

  it("дубль: той самий телефон у межах 10 хвилин не створює другої чернетки, інший час створює", async () => {
    const phone = uniquePhone();
    const first = await receiveSiteLead(t.db, lead({ phone }), { now: NOW });
    const again = await receiveSiteLead(t.db, lead({ phone }), {
      now: new Date(NOW.getTime() + 60_000),
    });
    if (!first.ok || !again.ok) throw new Error("очікувався успіх");
    expect(again).toEqual({ ok: true, draftId: first.draftId, duplicate: true });
    expect(await t.db.select().from(siteLeads)).toHaveLength(1);
    const later = await receiveSiteLead(
      t.db,
      { ...lead({ phone }), receivedAt: new Date(NOW.getTime() + 15 * 60_000).toISOString() },
      { now: NOW },
    );
    expect(later).toMatchObject({ ok: true, duplicate: false });
    expect(await t.db.select().from(siteLeads)).toHaveLength(2);
  });

  it("не розпізнаний телефон і некоректне тіло повертають 422 і 400, заявка не зберігається", async () => {
    expect(await receiveSiteLead(t.db, lead({ phone: "abc" }), { now: NOW })).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await receiveSiteLead(t.db, { lead: {} }, { now: NOW })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await receiveSiteLead(t.db, "рядок", { now: NOW })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await t.db.select().from(siteLeads)).toHaveLength(0);
  });

  it("невідомий тип заявки й невідомі позиції потрапляють у коментар; чернетка не втрачається", async () => {
    const result = await receiveSiteLead(
      t.db,
      lead({
        phone: uniquePhone(),
        type: "питання",
        items: [{ title: "Бокс 46 л", quantity: 2, unit: "шт" }],
        comment: undefined,
      }),
      { now: NOW },
    );
    if (!result.ok) throw new Error("очікувався успіх");
    const [order] = await t.db.select().from(orders).where(eq(orders.id, result.draftId));
    expect(order!.comment).toContain("Тип заявки: питання.");
    expect(order!.comment).toContain("Позиції: Бокс 46 л × 2 шт.");
    expect(order!.kgSold).toBe("0.000");
  });

  it("консультація: чернетки немає (D153)", () => {
    expect(isConsultation(lead({ phone: "0671112233", type: "Консультація" }))).toBe(true);
    expect(isConsultation(lead({ phone: "0671112233", type: "замовлення" }))).toBe(false);
    expect(isConsultation("рядок")).toBe(false);
  });

  it("склад із сайту обирає менеджер (D152): до цього підтвердити не можна, збереження форми знімає позначку", async () => {
    const known = uniquePhone();
    await t.db
      .insert(clientContacts)
      .values({ clientId: t.client.id, name: "Олена", phone: known });
    const result = await receiveSiteLead(t.db, lead({ phone: known }), { now: NOW });
    if (!result.ok) throw new Error("очікувався успіх");
    const load = async () =>
      (await t.db.select().from(orders).where(eq(orders.id, result.draftId)))[0]!;
    expect((await load()).draftPayload).toMatchObject({ locationPending: true, repeat: true });
    expect(((await load()).draftPayload as { unclear: string[] }).unclear).toEqual(
      expect.arrayContaining([LOCATION_PENDING_NOTE, REPEAT_CONTACT_NOTE]),
    );
    await expect(
      transitionOrder(t.db, t.users.manager, result.draftId, "confirmed"),
    ).rejects.toThrow("Оберіть склад");

    await updateOrder(t.db, t.users.manager, result.draftId, {
      locationId: (await load()).locationId,
    });
    const after = (await load()).draftPayload as { locationPending: boolean; unclear: string[] };
    expect(after.locationPending).toBe(false);
    expect(after.unclear).not.toContain(LOCATION_PENDING_NOTE);
    await transitionOrder(t.db, t.users.manager, result.draftId, "confirmed");
    expect((await load()).status).toBe("confirmed");
  });

  it("повторне звернення (D154): нова людина без позначки, друга заявка з того ж телефону з позначкою, клієнта не створюємо", async () => {
    const phone = uniquePhone();
    const first = await receiveSiteLead(t.db, lead({ phone }), { now: NOW });
    const second = await receiveSiteLead(
      t.db,
      { ...lead({ phone }), receivedAt: "2034-08-12T09:00:00Z" },
      { now: new Date("2034-08-12T09:00:00Z") },
    );
    if (!first.ok || !second.ok) throw new Error("очікувався успіх");
    const payload = async (id: string) =>
      (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!.draftPayload as {
        repeat: boolean;
        isPlaceholder: boolean;
      };
    expect(await payload(first.draftId)).toMatchObject({ repeat: false, isPlaceholder: true });
    expect(await payload(second.draftId)).toMatchObject({ repeat: true, isPlaceholder: true });
  });
});
