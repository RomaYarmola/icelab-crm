import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bankAccounts, integrationLogs, payments, settings } from "@/db/schema";
import {
  fetchClientInfo,
  fetchStatement,
  MonobankError,
  type MonobankClientInfo,
  type MonobankStatementItem,
} from "@/server/monobank/client";
import {
  ALERT_KEY,
  isIncomingUah,
  pickFopAccounts,
  runMonobankSync,
  syncStatements,
} from "@/server/monobank/sync";
import { getMonobankStatus, syncMonobankNow } from "@/server/monobank/status";
import { ForbiddenError } from "@/server/guards";
import { USER_ROLES } from "@/server/permissions";
import { type OrderTestContext, setupOrderTests } from "./order-helpers";

const TOKEN = "секретний-токен-123";
const NOW = new Date("2026-11-23T12:00:00Z");

const info: MonobankClientInfo = {
  accounts: [
    { id: "black-1", type: "black", currencyCode: 980, iban: "UA00" },
    { id: "fop-1", type: "fop", currencyCode: 980, iban: "UA11" },
    { id: "fop-usd", type: "fop", currencyCode: 840 },
  ],
};
const item = (over: Partial<MonobankStatementItem> = {}): MonobankStatementItem => ({
  id: "op-1",
  time: Math.floor(NOW.getTime() / 1000) - 3600,
  description: "Від: Кафе Тест",
  amount: 225000,
  currencyCode: 980,
  comment: "Замовлення 1340",
  counterName: "Кафе Тест",
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("monobank: клієнт, відбір рахунку ФОП, виписка (B13, D186)", () => {
  let t: OrderTestContext;

  beforeAll(async () => {
    t = await setupOrderTests();
  });
  afterAll(async () => {
    await t.ctx.client.close();
  });
  beforeEach(async () => {
    await t.db.delete(payments);
    await t.db.delete(bankAccounts);
    await t.db.delete(settings).where(eq(settings.key, ALERT_KEY));
  });

  describe("відбір", () => {
    it("з усіх рахунків лишається лише ФОП у гривні", () => {
      expect(pickFopAccounts(info.accounts).map((a) => a.id)).toEqual(["fop-1"]);
      expect(pickFopAccounts(undefined)).toEqual([]);
    });
    it("надходженням вважаємо лише додатну суму в гривні", () => {
      expect(isIncomingUah(item())).toBe(true);
      expect(isIncomingUah(item({ amount: -100 }))).toBe(false);
      expect(isIncomingUah(item({ currencyCode: 840 }))).toBe(false);
    });
  });

  describe("клієнт", () => {
    it("шле токен у заголовку, а в журнал його не пише", async () => {
      const fetchImpl = vi.fn(async () => json(info)) as unknown as typeof fetch;
      await fetchClientInfo(t.db, { token: TOKEN, fetchImpl });
      const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect((call[1] as RequestInit).headers).toMatchObject({ "X-Token": TOKEN });
      const logs = await t.db
        .select()
        .from(integrationLogs)
        .where(eq(integrationLogs.service, "monobank"));
      expect(logs.at(-1)).toMatchObject({ operation: "client-info", status: 200 });
      expect(JSON.stringify(logs)).not.toContain(TOKEN);
    });

    it("без токена: зрозуміла помилка й жодного запиту", async () => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await expect(fetchClientInfo(t.db, { token: null, fetchImpl })).rejects.toThrow(
        /MONOPAY_API_KEY/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("мережева помилка: три спроби, потім помилка; 403 і 429 не повторюються", async () => {
      const failing = vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      await expect(
        fetchClientInfo(t.db, { token: TOKEN, fetchImpl: failing, retryDelaysMs: [0, 0, 0] }),
      ).rejects.toThrow(/Немає зв'язку/);
      expect(failing).toHaveBeenCalledTimes(3);

      for (const status of [403, 429]) {
        const denied = vi.fn(async () => json({}, status)) as unknown as typeof fetch;
        const error = await fetchClientInfo(t.db, { token: TOKEN, fetchImpl: denied }).catch(
          (e) => e,
        );
        expect(error).toBeInstanceOf(MonobankError);
        expect(error.status).toBe(status);
        expect(denied).toHaveBeenCalledTimes(1);
      }
    });

    it("5xx повторюється й може вдатися з другої спроби", async () => {
      let n = 0;
      const flaky = vi.fn(async () =>
        ++n === 1 ? json({}, 502) : json(info),
      ) as unknown as typeof fetch;
      const result = await fetchClientInfo(t.db, {
        token: TOKEN,
        fetchImpl: flaky,
        retryDelaysMs: [0, 0],
      });
      expect(result.accounts).toHaveLength(3);
      expect(flaky).toHaveBeenCalledTimes(2);
    });

    it("адреса виписки: рахунок і час у секундах", async () => {
      const fetchImpl = vi.fn(async () => json([])) as unknown as typeof fetch;
      await fetchStatement(t.db, "fop-1", new Date(2_000_000_000), new Date(2_000_086_400), {
        token: TOKEN,
        fetchImpl,
      });
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain(
        "/personal/statement/fop-1/2000000/2000086",
      );
    });
  });

  describe("синхронізація", () => {
    const run = (statements: MonobankStatementItem[], now = NOW, extra: object = {}) =>
      runMonobankSync(t.db, {
        info: async () => info,
        statement: async () => statements,
        now,
        ...extra,
      });

    it("перший запуск: лише ФОП-рахунок у базі, лише надходження; повтор не дублює", async () => {
      const first = await run([
        item(),
        item({ id: "op-out", amount: -500 }),
        item({ id: "op-usd", currencyCode: 840 }),
      ]);
      expect(first).toMatchObject({ accountsFound: 1, fetched: 3, inserted: 1, errors: [] });
      const accounts = await t.db.select().from(bankAccounts);
      expect(accounts.map((a) => a.accountId)).toEqual(["fop-1"]);
      expect(accounts[0]!.lastStatementTo).toEqual(NOW);

      const later = new Date(NOW.getTime() + 15 * 60_000);
      const second = await run([item(), item({ id: "op-2", amount: 10000 })], later);
      expect(second.inserted).toBe(1);
      const rows = await t.db.select().from(payments);
      expect(rows).toHaveLength(2);
      expect(rows.find((p) => p.externalId === "op-1")).toMatchObject({
        amount: "2250.00",
        matchStatus: "unmatched",
        importedVia: "api",
        comment: "Замовлення 1340",
        counterName: "Кафе Тест",
      });
    });

    it("виписка просить від «до чого дійшли мінус 2 дні»", async () => {
      await run([]);
      const calls: { from: Date; to: Date }[] = [];
      const later = new Date(NOW.getTime() + 15 * 60_000);
      await runMonobankSync(t.db, {
        info: async () => info,
        statement: async (_db, _id, from, to) => {
          calls.push({ from, to });
          return [];
        },
        now: later,
      });
      expect(calls[0]!.from).toEqual(new Date(NOW.getTime() - 2 * 86_400_000));
      expect(calls[0]!.to).toEqual(later);
    });

    it("не частіше за раз на 60 секунд", async () => {
      await run([]);
      const statement = vi.fn(async () => []);
      const result = await runMonobankSync(t.db, {
        info: async () => info,
        statement,
        now: new Date(NOW.getTime() + 30_000),
      });
      expect(statement).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it("403: помилка в рахунку, власнику одне повідомлення, успіх знімає позначку", async () => {
      await run([]);
      const notify = vi.fn<(text: string) => Promise<undefined>>(async () => undefined);
      const denied = async () => {
        throw new MonobankError("monobank відхилив токен.", 403);
      };
      const t1 = new Date(NOW.getTime() + 10 * 60_000);
      const bad = await syncStatements(t.db, { statement: denied, notify, now: t1 });
      expect(bad.errors).toHaveLength(1);
      await syncStatements(t.db, {
        statement: denied,
        notify,
        now: new Date(t1.getTime() + 120_000),
      });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![0]).toContain("Токен monobank не працює");
      expect((await t.db.select().from(bankAccounts))[0]!.lastError).toContain("відхилив");

      const ok = await runMonobankSync(t.db, {
        info: async () => info,
        statement: async () => [],
        now: new Date(t1.getTime() + 600_000),
      });
      expect(ok.errors).toEqual([]);
      expect((await t.db.select().from(bankAccounts))[0]!.lastError).toBeNull();
      expect(await t.db.select().from(settings).where(eq(settings.key, ALERT_KEY))).toHaveLength(0);
    });

    it("відмова токена вже на client-info теж сповіщає й не падає", async () => {
      const notify = vi.fn(async () => undefined);
      const result = await runMonobankSync(t.db, {
        info: async () => {
          throw new MonobankError("monobank відхилив токен.", 403);
        },
        notify,
      });
      expect(result.errors).toHaveLength(1);
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });

  describe("екран і права", () => {
    it("статус бачать і запускають лише власник і бухгалтер; токен у відповіді лише як «є»", async () => {
      for (const role of USER_ROLES) {
        const attempt = getMonobankStatus(t.db, t.users[role]);
        if (role === "owner" || role === "accountant") {
          const status = await attempt;
          expect(JSON.stringify(status)).not.toContain(TOKEN);
          expect(typeof status.hasToken).toBe("boolean");
        } else {
          await expect(attempt, role).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
      await expect(syncMonobankNow(t.db, t.users.manager)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
