import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clientAddresses, npCities, npSyncState, npWarehouses } from "@/db/schema";
import { NpError } from "@/server/np/client";
import {
  getSyncStatus,
  NP_PAGE_SIZE,
  runDirectorySync,
  syncDirectoriesNow,
} from "@/server/np/directories";
import { ForbiddenError } from "@/server/guards";
import { isCronRequest } from "@/server/cron-auth";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

type Page = unknown[];

/** `fetch` для Нової Пошти: віддає задані сторінки міст і відділень за номером сторінки. */
function fakeNp(pages: { cities: Page[]; warehouses: Page[] }, failOn?: string) {
  return vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      calledMethod: string;
      methodProperties: { Page: string };
    };
    const key = `${body.calledMethod}:${body.methodProperties.Page}`;
    if (failOn === key) return Promise.reject(new TypeError("fetch failed"));
    const list = body.calledMethod === "getCities" ? pages.cities : pages.warehouses;
    const data = list[Number(body.methodProperties.Page) - 1] ?? [];
    return Promise.resolve(new Response(JSON.stringify({ success: true, data, errors: [] })));
  });
}

const city = (i: number, name = `Місто ${i}`) => ({
  Ref: `city-${i}`,
  Description: name,
  AreaDescription: "Київська",
});
const wh = (i: number, cityRef: string, extra: Record<string, unknown> = {}) => ({
  Ref: `wh-${i}`,
  Description: `Відділення №${i}`,
  Number: String(i),
  TypeOfWarehouse: "Branch",
  CityRef: cityRef,
  WarehouseStatus: "Working",
  ...extra,
});
const fullPage = (make: (i: number) => unknown) =>
  Array.from({ length: NP_PAGE_SIZE }, (_, i) => make(i + 1));

describe("довідники Нової Пошти: порційне оновлення (B10, D125)", () => {
  let t: OrderTestContext;
  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(npSyncState);
    await t.db.delete(npWarehouses);
    await t.db.delete(npCities);
  });

  const api = (pages: Parameters<typeof fakeNp>[0], failOn?: string) => ({
    apiKey: "k",
    fetchImpl: fakeNp(pages, failOn) as never,
    retryDelayMs: 0,
  });

  it("прогін у кілька викликів: міста, відділення, підсумок; стан тримається між викликами", async () => {
    const pages = {
      cities: [fullPage((i) => city(i)), [city(501, "Хвостове")]],
      warehouses: [[wh(1, "city-1"), wh(2, "city-1")]],
    };
    const first = await runDirectorySync(t.db, { maxPages: 1, api: api(pages) });
    expect(first).toMatchObject({ status: "progress", phase: "cities", page: 2 });
    const second = await runDirectorySync(t.db, { maxPages: 1, api: api(pages) });
    expect(second).toMatchObject({ status: "progress", phase: "warehouses", page: 1 });
    const done = await runDirectorySync(t.db, { maxPages: 1, api: api(pages) });
    expect(done.status).toBe("done");
    expect(done.message).toContain("міст 501");
    expect(done.message).toContain("відділень 2");
    const status = await getSyncStatus(t.db);
    expect(status).toMatchObject({
      phase: "idle",
      storedCities: 501,
      storedWarehouses: 2,
      citiesCount: 501,
      warehousesCount: 2,
    });
    expect(status.lastFinishedAt).not.toBeNull();
  });

  it("свіжі довідники не оновлюємо, ручний запуск власника оновлює", async () => {
    const pages = { cities: [[city(1)]], warehouses: [[wh(1, "city-1")]] };
    await runDirectorySync(t.db, { api: api(pages) });
    const again = await runDirectorySync(t.db, { api: api(pages) });
    expect(again.status).toBe("fresh");
    const forced = await syncDirectoriesNow(t.db, t.users.owner, { api: api(pages) });
    expect(forced.status).toBe("done");
    await expect(syncDirectoriesNow(t.db, t.users.manager, { api: api(pages) })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("збій посередині: помилка, стан лишається на тій сторінці, наступний виклик продовжує", async () => {
    const pages = {
      cities: [fullPage((i) => city(i)), [city(501)]],
      warehouses: [[wh(1, "city-1")]],
    };
    await expect(
      runDirectorySync(t.db, { maxPages: 5, api: api(pages, "getCities:2") }),
    ).rejects.toThrow(NpError);
    expect((await getSyncStatus(t.db)).page).toBe(2);
    expect((await getSyncStatus(t.db)).phase).toBe("cities");
    const resumed = await runDirectorySync(t.db, { maxPages: 5, api: api(pages) });
    expect(resumed.status).toBe("done");
    expect((await getSyncStatus(t.db)).storedCities).toBe(501);
  });

  it("зниклі записи стають неактивними, непрацюючі відділення теж, зіставлені адреси знову «потребують уточнення»", async () => {
    await runDirectorySync(t.db, {
      api: api({
        cities: [[city(1, "Київ"), city(2, "Львів")]],
        warehouses: [[wh(1, "city-1"), wh(2, "city-1"), wh(3, "city-2")]],
      }),
    });
    const [addr] = await t.db
      .insert(clientAddresses)
      .values({
        clientId: t.client.id,
        kind: "np_warehouse",
        cityText: "Київ",
        npCityRef: "city-1",
        npWarehouseRef: "wh-2",
        npWarehouseNumber: "2",
        isResolved: true,
      })
      .returning();
    // Другий прогін: Львів і відділення 2 зникли, відділення 1 не працює.
    await runDirectorySync(t.db, {
      force: true,
      api: api({
        cities: [[city(1, "Київ")]],
        warehouses: [[wh(1, "city-1", { WarehouseStatus: "NotWorking" })]],
      }),
    });
    const cities = await t.db.select().from(npCities);
    expect(cities.find((c) => c.ref === "city-2")!.isActive).toBe(false);
    expect(cities.find((c) => c.ref === "city-1")!.isActive).toBe(true);
    const warehouses = await t.db.select().from(npWarehouses);
    expect(warehouses.find((w) => w.ref === "wh-1")!.isActive).toBe(false);
    expect(warehouses.find((w) => w.ref === "wh-2")!.isActive).toBe(false);
    const [after] = await t.db
      .select()
      .from(clientAddresses)
      .where(eq(clientAddresses.id, addr!.id));
    expect(after!.isResolved).toBe(false);
  });

  it("секрет розкладу: без налаштованого секрету й з чужим доступу немає", () => {
    const req = (secret?: string) =>
      new Request("http://x/api/cron/np-directories", {
        headers: secret ? { "x-cron-secret": secret } : {},
      });
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronRequest(req("anything"))).toBe(false);
    vi.stubEnv("CRON_SECRET", "right-secret");
    expect(isCronRequest(req())).toBe(false);
    expect(isCronRequest(req("other-secret-xxx"))).toBe(false);
    expect(isCronRequest(req("right-secret"))).toBe(true);
    vi.unstubAllEnvs();
  });
});
