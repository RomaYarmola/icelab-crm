import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationLogs, orders, settings } from "@/db/schema";
import { ForbiddenError } from "@/server/guards";
import { createIbanInvoice, listIbanAccounts } from "@/server/ibanoplata/client";
import { transitionOrder } from "@/server/order-status";
import {
  createPaymentLinks,
  getPaymentLinkStatus,
  IBAN_ACCOUNT_KEY,
  setPaymentLinkAccount,
} from "@/server/payment-links";
import { listDebts } from "@/server/payment-views";
import { linkKey, splitPaymentGroups } from "@/utils/debtMessage";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const account = (uid: string, isSuspended = false) => ({
  ibanAccountUid: uid,
  organizationName: `Отримувач ${uid}`,
  identificationCode: "1234567890",
  iban: "UA000000000000000000000000007",
  isSuspended,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Підмінений сервіс: рахунки й посилання, запити запам'ятовуємо. */
function service(accounts = [account("a1")], invoice: () => Response = () => created()) {
  const requests: { url: string; method: string; key: string | null; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? "GET",
      key: new Headers(init?.headers).get("X-Api-Key"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return String(url).endsWith("/v2/iban-account") ? json(accounts) : invoice();
  });
  return {
    requests,
    options: { key: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch },
  };
}

let counter = 0;
const created = () => {
  counter += 1;
  return json({ ibanInvoiceUid: `u${counter}`, ibanInvoiceUrl: `https://pay.example/${counter}` });
};

describe("посилання на оплату IBAN oplata (D239)", () => {
  let t: OrderTestContext;
  const now = new Date("2026-11-20T10:00:00Z");

  beforeAll(async () => {
    t = await setupOrderTests();
    for (let index = 0; index < 2; index += 1) {
      const { id } = await t.create({ paymentKind: "fop", kgSold: 10 });
      for (const status of ["confirmed", "in_production", "packed", "shipped"] as const) {
        await transitionOrder(t.db, t.users.owner, id, status);
      }
      await t.db
        .update(orders)
        .set({ shippedAt: new Date("2026-11-13T10:00:00Z") })
        .where(eq(orders.id, id));
    }
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });

  const debt = async () => (await listDebts(t.db, t.users.owner, now))[0]!;
  const request = async () => {
    const item = await debt();
    return { clientId: item.clientId, orderIds: item.orders.map((order) => order.id) };
  };

  it("створює посилання на суму боргу з номерами в призначенні, ключ у заголовку", async () => {
    const stub = service();
    const result = await createPaymentLinks(t.db, t.users.accountant, await request(), {
      ...stub.options,
      now,
    });
    const [group] = splitPaymentGroups((await debt()).orders);
    expect(result).toEqual({
      links: { [linkKey(group!)]: expect.stringMatching(/^https:\/\/pay\.example\//) },
      error: null,
    });
    const post = stub.requests.find((r) => r.method === "POST")!;
    expect(post).toMatchObject({ url: "https://api.ibanoplata.com/v2/iban-invoice" });
    expect(post.key).toBe("test-key");
    expect(post.body).toEqual({
      organizationName: "Отримувач a1",
      identificationCode: "1234567890",
      iban: "UA000000000000000000000000007",
      amount: 1500,
      paymentPurpose: group!.purpose,
    });
  });

  it("журнал викликів без ключа, реквізитів і сум", async () => {
    const rows = await t.db
      .select()
      .from(integrationLogs)
      .where(eq(integrationLogs.service, "ibanoplata"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/test-key|UA0000|1500|Отримувач/);
  });

  it("кілька рахунків: поки не вибрано, не створює; вибраний використовує, призупинений ні", async () => {
    const stub = service([account("a1"), account("a2"), account("a3", true)]);
    const input = await request();
    const options = { ...stub.options, now };
    const first = await createPaymentLinks(t.db, t.users.owner, input, options);
    expect(first).toMatchObject({ links: {}, error: expect.stringContaining("Банк") });
    await expect(setPaymentLinkAccount(t.db, t.users.owner, "a3", stub.options)).rejects.toThrow(
      "чинний рахунок",
    );
    await setPaymentLinkAccount(t.db, t.users.accountant, "a2", stub.options);
    await createPaymentLinks(t.db, t.users.owner, input, options);
    expect(stub.requests.at(-1)!.body).toMatchObject({ organizationName: "Отримувач a2" });
    const status = await getPaymentLinkStatus(t.db, t.users.owner, stub.options);
    expect(status.selectedUid).toBe("a2");
    expect(status.accounts.map((a) => a.uid)).toEqual(["a1", "a2"]);
    expect(status.accounts[0]!.label).toBe("Отримувач a1, рахунок …0007");
    await t.db.delete(settings).where(eq(settings.key, IBAN_ACCOUNT_KEY));
  });

  it("помилки сервісу зрозумілі, POST не повторюється; без ключа пояснення", async () => {
    const stub = service([account("a1")], () => json({ message: "no" }, 403));
    const result = await createPaymentLinks(t.db, t.users.owner, await request(), {
      ...stub.options,
      now,
    });
    expect(result.error).toContain("відхилив ключ");
    expect(stub.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    const noKey = await createPaymentLinks(t.db, t.users.owner, await request(), {
      key: null,
      now,
    });
    expect(noKey.error).toContain("IBANOPLATA_API_KEY");
    expect(await getPaymentLinkStatus(t.db, t.users.owner, { key: null })).toMatchObject({
      hasKey: false,
    });
  });

  it("не приймає посилання не https і чужу відповідь", async () => {
    const bad = service([account("a1")], () =>
      json({ ibanInvoiceUid: "x", ibanInvoiceUrl: "javascript:alert(1)" }),
    );
    await expect(
      createIbanInvoice(
        t.db,
        {
          organizationName: "a",
          identificationCode: "1",
          iban: "UA",
          amount: 1,
          paymentPurpose: "p",
        },
        bad.options,
      ),
    ).rejects.toThrow("незрозумілому форматі");
    const offline = {
      key: "k",
      fetchImpl: (async () => {
        throw new Error("net");
      }) as unknown as typeof fetch,
    };
    await expect(listIbanAccounts(t.db, offline)).rejects.toThrow("Немає зв'язку");
  });

  it("лише власник і бухгалтер; чуже чи сплачене замовлення відхиляється", async () => {
    const stub = service();
    const input = await request();
    for (const actor of [t.users.manager, t.users.location_lead]) {
      await expect(
        createPaymentLinks(t.db, actor, input, { ...stub.options, now }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const { id } = await t.create({ paymentKind: "fop" });
    await expect(
      createPaymentLinks(
        t.db,
        t.users.owner,
        { ...input, orderIds: [id] },
        { ...stub.options, now },
      ),
    ).rejects.toThrow("Борги змінились");
    expect(stub.requests).toHaveLength(0);
  });
});
