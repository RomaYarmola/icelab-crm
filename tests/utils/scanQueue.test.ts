import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  flushQueue,
  newQueueItem,
  QUEUE_BATCH_SIZE,
  retryItem,
  summarizeQueue,
  type QueueItem,
  type QueueStore,
  type SendBatch,
  type SendOutcome,
} from "@/utils/scanQueue";
import { openScanStores } from "@/utils/scanQueueDb";

function memoryStore(): QueueStore & { items: Map<string, QueueItem> } {
  const items = new Map<string, QueueItem>();
  return {
    items,
    all: async () => [...items.values()],
    put: async (item) => void items.set(item.queueId, item),
    remove: async (id) => void items.delete(id),
  };
}

const at = (seconds: number) => new Date(Date.UTC(2034, 0, 1, 10, 0, seconds));
const scan = (i: number, action: "issue" | "return" = "issue") =>
  newQueueItem(
    { code: `K-${String(i).padStart(4, "0")}`, action, orderId: action === "issue" ? "o1" : null },
    at(i),
    `q-${i}`,
  );

const okAll: SendBatch = async (items) =>
  items.map((item): SendOutcome => ({
    queueId: item.queueId,
    code: item.code,
    result: "ok",
    message: "Видано",
    duplicate: false,
  }));

describe("офлайн-черга сканів (ТЗ §9, D112)", () => {
  it("20 сканів без мережі лишаються в черзі, а коли мережа з'явилась, летять без втрат (критерій 4 ТЗ)", async () => {
    const store = memoryStore();
    for (let i = 1; i <= 20; i++) await store.put(scan(i));
    const offline = await flushQueue(store, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(offline).toEqual({ outcomes: [], failed: true });
    expect(summarizeQueue(await store.all())).toEqual({ pending: 20, attention: 0 });

    const sentIds: string[] = [];
    const online = await flushQueue(store, async (batch) => {
      sentIds.push(...batch.map((b) => b.queueId));
      return okAll(batch);
    });
    expect(online.failed).toBe(false);
    expect(online.outcomes).toHaveLength(20);
    expect(new Set(sentIds).size).toBe(20);
    expect(store.items.size).toBe(0);
  });

  it("пакети по 20 у порядку часу скану, а не порядку запису", async () => {
    const store = memoryStore();
    const total = QUEUE_BATCH_SIZE * 2 + 5;
    for (let i = total; i >= 1; i--) await store.put(scan(i));
    const batches: string[][] = [];
    await flushQueue(store, async (batch) => {
      batches.push(batch.map((b) => b.queueId));
      return okAll(batch);
    });
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toEqual(Array.from({ length: total }, (_, i) => `q-${i + 1}`));
  });

  it("обрив у середині: відправлене зникло з черги, решта лишилась, повтор довантажує без дублів", async () => {
    const store = memoryStore();
    for (let i = 1; i <= 30; i++) await store.put(scan(i));
    let calls = 0;
    const flaky: SendBatch = async (batch) => {
      if (++calls === 2) throw new TypeError("Failed to fetch");
      return okAll(batch);
    };
    const first = await flushQueue(store, flaky);
    expect(first.failed).toBe(true);
    expect(first.outcomes).toHaveLength(20);
    expect(store.items.size).toBe(10);
    const second = await flushQueue(store, okAll);
    expect(second.failed).toBe(false);
    expect(second.outcomes.map((o) => o.queueId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `q-${i + 21}`),
    );
    expect(store.items.size).toBe(0);
  });

  it("помилка сервера позначає скан «потребує уваги» з текстом, решта пакета проходить", async () => {
    const store = memoryStore();
    for (let i = 1; i <= 3; i++) await store.put(scan(i));
    const mixed: SendBatch = async (batch) =>
      batch.map((item) =>
        item.queueId === "q-2"
          ? {
              queueId: item.queueId,
              code: item.code,
              result: "error",
              message: "Бокс не знайдено.",
              duplicate: false,
            }
          : {
              queueId: item.queueId,
              code: item.code,
              result: "ok",
              message: "Видано",
              duplicate: false,
            },
      );
    await flushQueue(store, mixed);
    expect(store.items.size).toBe(1);
    expect(store.items.get("q-2")).toMatchObject({
      state: "attention",
      message: "Бокс не знайдено.",
    });
    expect(summarizeQueue(await store.all())).toEqual({ pending: 0, attention: 1 });

    // Скан «потребує уваги» не відправляється сам, поки його не повернули в чергу.
    let sent = 0;
    await flushQueue(store, async (b) => ((sent += b.length), okAll(b)));
    expect(sent).toBe(0);
    await retryItem(store, "q-2");
    await flushQueue(store, async (b) => ((sent += b.length), okAll(b)));
    expect(sent).toBe(1);
    expect(store.items.size).toBe(0);
  });

  it("попередження й повторні відповіді сервера теж прибирають скан з черги", async () => {
    const store = memoryStore();
    await store.put(scan(1));
    await store.put(scan(2, "return"));
    await flushQueue(store, async (batch) => [
      {
        queueId: batch[0]!.queueId,
        code: batch[0]!.code,
        result: "warning",
        message: "Бокс уже на складі",
        duplicate: false,
      },
      {
        queueId: batch[1]!.queueId,
        code: batch[1]!.code,
        result: "ok",
        message: "Уже записано раніше.",
        duplicate: true,
      },
    ]);
    expect(store.items.size).toBe(0);
  });

  it("сервер не відповів про скан: він лишається в черзі", async () => {
    const store = memoryStore();
    await store.put(scan(1));
    await store.put(scan(2));
    await flushQueue(store, async (batch) => okAll([batch[0]!]));
    expect([...store.items.keys()]).toEqual(["q-2"]);
  });

  describe("IndexedDB", () => {
    it("скан переживає перезапуск: записаний у сховище читається знову, видалення працює", async () => {
      const factory = new IDBFactory();
      const first = await openScanStores(factory);
      await first.queue.put(scan(1));
      await first.queue.put(scan(2, "return"));
      const reopened = await openScanStores(factory);
      expect((await reopened.queue.all()).map((i) => i.queueId).sort()).toEqual(["q-1", "q-2"]);
      expect((await reopened.queue.all()).find((i) => i.queueId === "q-2")).toMatchObject({
        action: "return",
        orderId: null,
      });
      await reopened.queue.remove("q-1");
      expect((await reopened.queue.all()).map((i) => i.queueId)).toEqual(["q-2"]);
    });

    it("службові значення (список замовлень) і очищення при виході", async () => {
      const stores = await openScanStores(new IDBFactory());
      expect(await stores.meta.get("orders")).toBeUndefined();
      await stores.meta.set("orders", { date: "2034-01-01", orders: [{ id: "o1" }] });
      expect(await stores.meta.get("orders")).toEqual({
        date: "2034-01-01",
        orders: [{ id: "o1" }],
      });
      await stores.queue.put(scan(1));
      await stores.clear();
      expect(await stores.queue.all()).toEqual([]);
      expect(await stores.meta.get("orders")).toBeUndefined();
    });

    it("flush працює поверх справжнього IndexedDB так само", async () => {
      const stores = await openScanStores(new IDBFactory());
      for (let i = 1; i <= 25; i++) await stores.queue.put(scan(i));
      const result = await flushQueue(stores.queue, okAll);
      expect(result.outcomes).toHaveLength(25);
      expect(await stores.queue.all()).toEqual([]);
    });
  });
});
