import type { QueueItem, QueueStore } from "./scanQueue";

/**
 * Сховище черги сканів у IndexedDB телефона (B9, D112). База `icelab-scan`: черга (`queue`, ключ
 * `queueId`) і службові значення (`meta`, наприклад останній список замовлень для офлайн-режиму).
 */

const DB_NAME = "icelab-scan";
const DB_VERSION = 1;

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("queue"))
        db.createObjectStore("queue", { keyPath: "queueId" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  db: IDBDatabase,
  storeName: "queue" | "meta",
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export type ScanMetaStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

/** Черга й службові значення в IndexedDB. `factory` передаємо в тесті, у браузері це `indexedDB`. */
export async function openScanStores(
  factory: IDBFactory = indexedDB,
): Promise<{ queue: QueueStore; meta: ScanMetaStore; clear(): Promise<void> }> {
  const db = await openDb(factory);
  return {
    queue: {
      all: () => run<QueueItem[]>(db, "queue", "readonly", (s) => s.getAll()),
      put: async (item) => void (await run(db, "queue", "readwrite", (s) => s.put(item))),
      remove: async (id) => void (await run(db, "queue", "readwrite", (s) => s.delete(id))),
    },
    meta: {
      get: <T>(key: string) => run<T | undefined>(db, "meta", "readonly", (s) => s.get(key)),
      set: async (key, value) =>
        void (await run(db, "meta", "readwrite", (s) => s.put(value, key))),
    },
    /** Очистити все на пристрої (при виході з акаунта). */
    clear: async () => {
      await run(db, "queue", "readwrite", (s) => s.clear());
      await run(db, "meta", "readwrite", (s) => s.clear());
    },
  };
}
