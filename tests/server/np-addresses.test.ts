import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientAddresses, npCities, npWarehouses } from "@/db/schema";
import { addAddress, updateAddress } from "@/server/client-details";
import { ForbiddenError } from "@/server/guards";
import {
  autoResolveAddresses,
  listUnresolvedAddresses,
  normalizeCity,
  parseWarehouseNumber,
  resolveClientAddress,
  searchNpCities,
  searchNpWarehouses,
} from "@/server/np/addresses";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

describe("підбір адрес у довідниках Нової Пошти (B10, D126)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
    await t.db.insert(npCities).values([
      { ref: "kyiv", nameUa: "Київ", areaUa: "Київська" },
      { ref: "kyiv-obl", nameUa: "Київське", areaUa: "Одеська" },
      { ref: "lviv", nameUa: "Львів", areaUa: "Львівська" },
      { ref: "ber1", nameUa: "Березівка", areaUa: "Одеська" },
      { ref: "ber2", nameUa: "Березівка", areaUa: "Львівська" },
      { ref: "old", nameUa: "Старе місто", isActive: false },
    ]);
    await t.db.insert(npWarehouses).values([
      { ref: "w1", cityRef: "kyiv", nameUa: "Відділення №1", number: "1" },
      { ref: "w12", cityRef: "kyiv", nameUa: "Відділення №12", number: "12" },
      { ref: "w5", cityRef: "kyiv", nameUa: "Відділення №5: вул. Хрещатик", number: "5" },
      {
        ref: "wx",
        cityRef: "kyiv",
        nameUa: "Відділення №7 (зачинено)",
        number: "7",
        isActive: false,
      },
    ]);
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(clientAddresses);
  });

  const address = async (values: Partial<typeof clientAddresses.$inferInsert>) =>
    (
      await t.db
        .insert(clientAddresses)
        .values({ clientId: t.client.id, kind: "np_warehouse", ...values })
        .returning()
    )[0]!;
  const reload = async (id: string) =>
    (await t.db.select().from(clientAddresses).where(eq(clientAddresses.id, id)))[0]!;

  it("адреса Нової Пошти з довідника (20.11.2026): місто й відділення зіставляються одразу, текстової адреси немає", async () => {
    const added = await addAddress(t.db, owner(), t.client.id, {
      label: "Склад Київ",
      kind: "np_warehouse",
      npCityRef: "kyiv",
      npWarehouseRef: "w5",
      recipientName: "Іван Петренко",
      recipientPhone: "050 123 45 67",
      timeWindow: "9-11",
    });
    expect(await reload(added.id)).toMatchObject({
      cityText: "Київ",
      addressText: null,
      npCityRef: "kyiv",
      npWarehouseRef: "w5",
      npWarehouseNumber: "5",
      recipientName: "Іван Петренко",
      recipientPhone: "+380501234567",
      timeWindow: null,
      isResolved: true,
    });
    // Кур'єр: лише місто з довідника, адреса текстом обов'язкова, зіставлено без відділення.
    const courier = await addAddress(t.db, owner(), t.client.id, {
      label: "Кур'єр",
      kind: "np_address",
      npCityRef: "lviv",
      addressText: "вул. Шевченка, 1",
      recipientName: "Марія",
      recipientPhone: "0671112233",
    });
    expect(await reload(courier.id)).toMatchObject({
      cityText: "Львів",
      npCityRef: "lviv",
      npWarehouseRef: null,
      isResolved: true,
    });
  });

  it("адреса Нової Пошти: отримувач і телефон обов'язкові, відділення має бути з вибраного міста", async () => {
    const base = {
      label: "А",
      kind: "np_warehouse" as const,
      npCityRef: "kyiv",
      npWarehouseRef: "w1",
    };
    await expect(addAddress(t.db, owner(), t.client.id, base)).rejects.toThrow(
      "Вкажіть отримувача",
    );
    await expect(
      addAddress(t.db, owner(), t.client.id, { ...base, recipientName: "Іван Петренко" }),
    ).rejects.toThrow("Вкажіть телефон отримувача");
    await expect(
      addAddress(t.db, owner(), t.client.id, {
        ...base,
        recipientName: "Іван Петренко",
        recipientPhone: "не телефон",
      }),
    ).rejects.toThrow("Не вдалося розпізнати телефон");
    await expect(
      addAddress(t.db, owner(), t.client.id, {
        ...base,
        npCityRef: "lviv",
        recipientName: "Іван Петренко",
        recipientPhone: "0501234567",
      }),
    ).rejects.toThrow("не знайдено в цьому місті");
    await expect(
      addAddress(t.db, owner(), t.client.id, {
        label: "К",
        kind: "np_address",
        npCityRef: "lviv",
        recipientName: "Марія",
        recipientPhone: "0671112233",
      }),
    ).rejects.toThrow("вулицю й будинок");
  });

  it("пошук міст: від двох літер, спершу точний збіг, потім початок назви, неактивні не показуємо", async () => {
    expect(await searchNpCities(t.db, owner(), "К")).toEqual([]);
    const found = await searchNpCities(t.db, owner(), "київ");
    expect(found.map((c) => c.name)).toEqual(["Київ", "Київське"]);
    expect(found[0]).toMatchObject({ ref: "kyiv", area: "Київська" });
    expect((await searchNpCities(t.db, owner(), "Старе")).length).toBe(0);
    expect((await searchNpCities(t.db, owner(), "100%")).length).toBe(0);
  });

  it("пошук відділень: за номером, за частиною назви, перші за порядком; неактивні ховаємо", async () => {
    expect((await searchNpWarehouses(t.db, owner(), "kyiv", "")).map((w) => w.number)).toEqual([
      "1",
      "5",
      "12",
    ]);
    expect((await searchNpWarehouses(t.db, owner(), "kyiv", "12")).map((w) => w.ref)).toEqual([
      "w12",
    ]);
    expect((await searchNpWarehouses(t.db, owner(), "kyiv", "№5")).map((w) => w.ref)).toEqual([
      "w5",
    ]);
    expect((await searchNpWarehouses(t.db, owner(), "kyiv", "Хрещатик")).map((w) => w.ref)).toEqual(
      ["w5"],
    );
    expect(await searchNpWarehouses(t.db, owner(), "kyiv", "7")).toEqual([]);
  });

  it("право на підбір мають ті, хто змінює клієнтів", async () => {
    for (const role of USER_ROLES) {
      const call = searchNpCities(t.db, t.users[role], "Київ");
      if (role === "owner" || role === "manager") await expect(call).resolves.toBeDefined();
      else await expect(call, role).rejects.toThrow(ForbiddenError);
    }
  });

  it("ручне зіставлення складу: місто й відділення, номер і місто підтягуються", async () => {
    const a = await address({ cityText: null, npWarehouseNumber: null });
    await resolveClientAddress(t.db, t.users.manager, {
      addressId: a.id,
      cityRef: "kyiv",
      warehouseRef: "w12",
    });
    expect(await reload(a.id)).toMatchObject({
      npCityRef: "kyiv",
      npWarehouseRef: "w12",
      npWarehouseNumber: "12",
      cityText: "Київ",
      isResolved: true,
    });
  });

  it("зіставлення: склад без відділення, чуже відділення, неактивне, не-НП адреса й неіснуюче місто відхиляються", async () => {
    const a = await address({});
    const base = { addressId: a.id, cityRef: "kyiv", warehouseRef: "w1" };
    await expect(
      resolveClientAddress(t.db, owner(), { ...base, warehouseRef: null }),
    ).rejects.toThrow("Оберіть відділення");
    await expect(resolveClientAddress(t.db, owner(), { ...base, cityRef: "lviv" })).rejects.toThrow(
      "Відділення не знайдено в цьому місті",
    );
    await expect(
      resolveClientAddress(t.db, owner(), { ...base, warehouseRef: "wx" }),
    ).rejects.toThrow("Відділення не знайдено");
    await expect(resolveClientAddress(t.db, owner(), { ...base, cityRef: "old" })).rejects.toThrow(
      "Місто не знайдено",
    );
    const door = await address({ kind: "delivery" });
    await expect(
      resolveClientAddress(t.db, owner(), { addressId: door.id, cityRef: "kyiv" }),
    ).rejects.toThrow("лише адреси Нової Пошти");
    await expect(resolveClientAddress(t.db, t.users.production, base)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("адреса Нової Пошти (до дверей) зіставляється лише за містом", async () => {
    const a = await address({ kind: "np_address", addressText: "вул. Тестова, 1" });
    await resolveClientAddress(t.db, owner(), { addressId: a.id, cityRef: "lviv" });
    expect(await reload(a.id)).toMatchObject({
      npCityRef: "lviv",
      npWarehouseRef: null,
      isResolved: true,
    });
  });

  it("правка тексту адреси скидає зіставлення", async () => {
    const a = await address({
      cityText: "Київ",
      npCityRef: "kyiv",
      npWarehouseRef: "w1",
      isResolved: true,
    });
    await updateAddress(t.db, owner(), a.id, {
      label: "Адреса",
      kind: "np_warehouse",
      cityText: "Київ",
      npWarehouseNumber: "5",
      recipientName: "Іван Петренко",
      recipientPhone: "+380501234567",
    });
    expect(await reload(a.id)).toMatchObject({
      npCityRef: null,
      npWarehouseRef: null,
      isResolved: false,
    });
  });

  it("автозіставлення: однозначні збіги зіставляються, двозначні й без номера лишаються", async () => {
    const ok = await address({ cityText: "м. Київ", npWarehouseNumber: "№5" });
    const door = await address({ kind: "np_address", cityText: "Львів", addressText: "вул. А, 1" });
    const ambiguousCity = await address({ cityText: "Березівка", npWarehouseNumber: "3" });
    const noNumber = await address({ cityText: "Київ", npWarehouseNumber: null });
    const unknownCity = await address({ cityText: "Нетутешнє", npWarehouseNumber: "1" });
    const closed = await address({ cityText: "Київ", npWarehouseNumber: "7" });
    const result = await autoResolveAddresses(t.db, owner());
    expect(result).toEqual({ checked: 6, resolved: 2, needsReview: 4 });
    expect(await reload(ok.id)).toMatchObject({
      isResolved: true,
      npWarehouseRef: "w5",
      npWarehouseNumber: "5",
    });
    expect(await reload(door.id)).toMatchObject({ isResolved: true, npCityRef: "lviv" });
    for (const row of [ambiguousCity, noNumber, unknownCity, closed]) {
      expect((await reload(row.id)).isResolved).toBe(false);
    }
    await expect(autoResolveAddresses(t.db, t.users.manager)).rejects.toThrow(ForbiddenError);
  });

  it("список «потребують уточнення»: клієнт, текст, лише не зіставлені адреси Нової Пошти", async () => {
    await address({ cityText: "Київ", npWarehouseNumber: "99" });
    await address({ cityText: "Київ", npWarehouseRef: "w1", isResolved: true });
    await address({ kind: "delivery", cityText: "Київ" });
    const list = await listUnresolvedAddresses(t.db, owner());
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      clientName: "Кафе Тест",
      kindLabel: "Склад Нової Пошти",
      text: "Київ, відділення № 99",
    });
    await expect(listUnresolvedAddresses(t.db, t.users.manager)).rejects.toThrow(ForbiddenError);
  });

  it("допоміжні: назва міста й номер відділення з тексту", () => {
    expect(normalizeCity("м. Київ")).toBe("київ");
    expect(normalizeCity("Місто Львів (Львівська обл.)")).toBe("львів");
    expect(normalizeCity("  Ів’янe  ")).toBe("ів'янe");
    expect(parseWarehouseNumber("Відділення №012")).toBe("12");
    expect(parseWarehouseNumber("немає")).toBeNull();
    expect(parseWarehouseNumber(null)).toBeNull();
  });
});
