import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { boxTypes, locations, settings } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { ForbiddenError } from "@/server/guards";
import {
  checkNpConnection,
  getNpSettings,
  listNpSenderDetails,
  listNpSenders,
  saveLocationSender,
  setBoxTypeEmptyWeight,
} from "@/server/np/settings";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const reply = (data: unknown[], extra: Record<string, unknown> = {}) =>
  Promise.resolve(new Response(JSON.stringify({ success: true, data, errors: [], ...extra })));

describe("налаштування Нової Пошти (B10, PR 1)", () => {
  let t: OrderTestContext;
  const owner = () => t.users.owner;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("лише власник: інші ролі отримують відмову", async () => {
    for (const role of USER_ROLES) {
      if (role === "owner") continue;
      await expect(getNpSettings(t.db, t.users[role]), role).rejects.toThrow(ForbiddenError);
      await expect(checkNpConnection(t.db, t.users[role]), role).rejects.toThrow(ForbiddenError);
      await expect(
        setBoxTypeEmptyWeight(t.db, t.users[role], { boxTypeId: "x", weightKg: "1" }),
        role,
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("екран: ключа немає, жодної перевірки, локації без відправника, типи тари без клієнтських", async () => {
    vi.stubEnv("NOVA_POSHTA_API_KEY", "");
    const view = await getNpSettings(t.db, owner());
    expect(view.hasKey).toBe(false);
    expect(view.lastCheck).toBeNull();
    expect(view.locations.length).toBeGreaterThanOrEqual(2);
    expect(view.locations.every((l) => !l.isConfigured)).toBe(true);
    const all = await t.db.select().from(boxTypes);
    const clientOwned = all.filter((x) => x.isClientOwned).map((x) => x.id);
    expect(view.boxTypes.some((x) => clientOwned.includes(x.id))).toBe(false);
  });

  it("перевірка з'єднання без ключа: помилка текстом, результат запам'ятовується", async () => {
    vi.stubEnv("NOVA_POSHTA_API_KEY", "");
    const result = await checkNpConnection(t.db, owner());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ключ Нової Пошти не налаштовано");
    const view = await getNpSettings(t.db, owner());
    expect(view.lastCheck?.ok).toBe(false);
  });

  it("перевірка з'єднання з ключем: успіх, кількість відправників, ключа в базі немає", async () => {
    vi.stubEnv("NOVA_POSHTA_API_KEY", "ключ-тест-12345");
    vi.stubGlobal("fetch", () => reply([{ Ref: "s1", Description: "ФОП Тест" }]));
    const result = await checkNpConnection(t.db, owner());
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain("1");
    expect((await getNpSettings(t.db, owner())).hasKey).toBe(true);
    const stored = JSON.stringify(await t.db.select().from(settings));
    expect(stored).not.toContain("ключ-тест-12345");
  });

  it("відправники, контакти й адреси підставляються з відповіді Нової Пошти", async () => {
    vi.stubEnv("NOVA_POSHTA_API_KEY", "k-12345678");
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const { calledMethod } = JSON.parse(init.body as string) as { calledMethod: string };
      if (calledMethod === "getCounterparties") return reply([{ Ref: "s1", Description: "ФОП А" }]);
      if (calledMethod === "getCounterpartyContactPersons")
        return reply([{ Ref: "c1", Description: "Олена Коваль" }]);
      return reply([{ Ref: "a1", Description: "Київ, відділення 5" }, { NoRef: true }]);
    });
    expect(await listNpSenders(t.db, owner())).toEqual([{ ref: "s1", name: "ФОП А" }]);
    expect(await listNpSenderDetails(t.db, owner(), "s1")).toEqual({
      contacts: [{ ref: "c1", name: "Олена Коваль" }],
      addresses: [{ ref: "a1", name: "Київ, відділення 5" }],
    });
    await expect(listNpSenderDetails(t.db, owner(), "")).rejects.toThrow(ValidationError);
  });

  it("відправник локації зберігається разом з назвами; погані дані відхиляються", async () => {
    const base = {
      locationId: t.location,
      senderRef: "s1",
      contactRef: "c1",
      addressRef: "a1",
      phone: "+380501234567",
      senderName: "ФОП А",
      contactName: "Олена",
      addressName: "Відділення 5",
    };
    await saveLocationSender(t.db, owner(), base);
    const [row] = await t.db.select().from(locations).where(eq(locations.id, t.location));
    expect(row).toMatchObject({
      npSenderRef: "s1",
      npSenderContactRef: "c1",
      npSenderAddressRef: "a1",
      npSenderPhone: "+380501234567",
    });
    const view = await getNpSettings(t.db, owner());
    const mine = view.locations.find((l) => l.locationId === t.location)!;
    expect(mine).toMatchObject({
      isConfigured: true,
      senderName: "ФОП А",
      addressName: "Відділення 5",
    });

    await expect(
      saveLocationSender(t.db, owner(), { ...base, phone: "0501234567" }),
    ).rejects.toThrow("Телефон у форматі");
    await expect(saveLocationSender(t.db, owner(), { ...base, senderRef: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      saveLocationSender(t.db, owner(), {
        ...base,
        locationId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow("Локацію не знайдено");
    await expect(saveLocationSender(t.db, t.users.manager, base)).rejects.toThrow(ForbiddenError);
  });

  it("вага порожнього бокса: кома, межі, очищення", async () => {
    const type = (await t.db.select().from(boxTypes)).find((x) => !x.isClientOwned)!;
    await setBoxTypeEmptyWeight(t.db, owner(), { boxTypeId: type.id, weightKg: "2,5" });
    let [row] = await t.db.select().from(boxTypes).where(eq(boxTypes.id, type.id));
    expect(Number(row!.emptyWeightKg)).toBe(2.5);
    await expect(
      setBoxTypeEmptyWeight(t.db, owner(), { boxTypeId: type.id, weightKg: "0" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      setBoxTypeEmptyWeight(t.db, owner(), { boxTypeId: type.id, weightKg: "abc" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      setBoxTypeEmptyWeight(t.db, owner(), { boxTypeId: type.id, weightKg: "101" }),
    ).rejects.toThrow(ValidationError);
    await setBoxTypeEmptyWeight(t.db, owner(), { boxTypeId: type.id, weightKg: "" });
    [row] = await t.db.select().from(boxTypes).where(eq(boxTypes.id, type.id));
    expect(row!.emptyWeightKg).toBeNull();
    await expect(
      setBoxTypeEmptyWeight(t.db, owner(), {
        boxTypeId: "00000000-0000-4000-8000-000000000000",
        weightKg: "1",
      }),
    ).rejects.toThrow("Тип бокса не знайдено");
  });
});
