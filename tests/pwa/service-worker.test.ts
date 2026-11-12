import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://crm.test";
const SOURCE = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

/**
 * Запускає справжній `public/sw.js` в ізольованому середовищі з підробленими `caches`, `fetch` і
 * подіями, щоб перевірити, що він кешує і що ні.
 */
function loadWorker() {
  const listeners = new Map<string, Listener>();
  const cacheStorage = new Map<string, Map<string, Response>>();
  const network = { online: true, requests: [] as string[], status: 200 };

  const urlOf = (request: Request | string) =>
    typeof request === "string" ? request : request.url;
  const abs = (url: string) => new URL(url, ORIGIN).toString();

  const fakeFetch = async (request: Request | string) => {
    network.requests.push(urlOf(request));
    if (!network.online) throw new TypeError("Failed to fetch");
    // Відповідь, схожа на справжню: той самий сайт («basic»), статус задає тест.
    const response = new Response(`відповідь для ${urlOf(request)}`, { status: network.status });
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };

  function cacheOf(name: string) {
    if (!cacheStorage.has(name)) cacheStorage.set(name, new Map());
    const store = cacheStorage.get(name)!;
    return {
      async addAll(urls: string[]) {
        for (const url of urls) store.set(abs(url), await fakeFetch(abs(url)));
      },
      async match(request: Request | string) {
        return store.get(abs(urlOf(request)))?.clone();
      },
      async put(request: Request | string, response: Response) {
        store.set(abs(urlOf(request)), response);
      },
    };
  }

  const caches = {
    async open(name: string) {
      return cacheOf(name);
    },
    async match(request: Request | string) {
      for (const store of cacheStorage.values()) {
        const hit = store.get(abs(urlOf(request)));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async keys() {
      return [...cacheStorage.keys()];
    },
    async delete(name: string) {
      return cacheStorage.delete(name);
    },
  };

  const state = { skipped: false, claimed: false };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {
      state.skipped = true;
    },
    clients: {
      claim: async () => {
        state.claimed = true;
      },
    },
  };

  vm.runInNewContext(SOURCE, { self, caches, fetch: fakeFetch, URL, Response, Promise });

  /** Запит `fetch`: повертає відповідь service worker або `undefined`, якщо він запит не чіпає. */
  async function request(
    url: string,
    options: { method?: string; mode?: string } = {},
  ): Promise<Response | undefined> {
    const req = {
      url: abs(url),
      method: options.method ?? "GET",
      mode: options.mode ?? "cors",
    };
    let result: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request: req,
      respondWith(promise: Promise<Response>) {
        result = promise;
      },
    });
    return result;
  }

  async function run(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.all(waits);
  }

  const cachedUrls = () =>
    [...cacheStorage.values()].flatMap((store) =>
      [...store.keys()].map((key) => new URL(key).pathname),
    );

  return { run, request, network, cacheStorage, cachedUrls, state };
}

describe("service worker", () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(async () => {
    worker = loadWorker();
    await worker.run("install");
  });

  it("при встановленні кешує лише статичні файли й сторінку «Немає зв'язку»", () => {
    expect(worker.state.skipped).toBe(true);
    expect(worker.cachedUrls().sort()).toEqual(
      [
        "/offline.html",
        "/images/logo/logo.svg",
        "/images/logo/mark.svg",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
      ].sort(),
    );
  });

  it("сторінки з даними завжди йдуть у мережу й не кешуються", async () => {
    const response = await worker.request("/orders", { mode: "navigate" });
    expect(await response?.text()).toContain("/orders");
    expect(worker.network.requests).toContain(`${ORIGIN}/orders`);
    expect(worker.cachedUrls()).not.toContain("/orders");
  });

  it("без інтернету замість сторінки показує «Немає зв'язку»", async () => {
    worker.network.online = false;
    const response = await worker.request("/orders", { mode: "navigate" });
    expect(await response?.text()).toContain("/offline.html");
  });

  it("не перехоплює дані: серверні запити RSC, /api, не-GET і чужі сайти", async () => {
    expect(await worker.request("/orders?_rsc=abc123")).toBeUndefined();
    expect(await worker.request("/api/health")).toBeUndefined();
    expect(await worker.request("/more/users/1", { method: "POST" })).toBeUndefined();
    expect(await worker.request("https://other.example/_next/static/a.js")).toBeUndefined();
    expect(
      worker.network.requests.filter(
        (url) => !url.endsWith(".png") && !url.endsWith(".svg") && !url.endsWith(".html"),
      ),
    ).toHaveLength(0);
    expect(
      worker.cachedUrls().some((url) => url.startsWith("/api") || url.startsWith("/orders")),
    ).toBe(false);
  });

  it("статичні файли з хешем кешує і далі віддає з кешу без мережі", async () => {
    const first = await worker.request("/_next/static/chunks/app-123.js");
    expect(await first?.text()).toContain("app-123.js");
    expect(worker.cachedUrls()).toContain("/_next/static/chunks/app-123.js");

    const before = worker.network.requests.length;
    worker.network.online = false;
    const second = await worker.request("/_next/static/chunks/app-123.js");
    expect(await second?.text()).toContain("app-123.js");
    expect(worker.network.requests).toHaveLength(before);
  });

  it("невдалу відповідь (404) у кеш не кладе", async () => {
    worker.network.status = 404;
    await worker.request("/_next/static/chunks/missing.js");
    expect(worker.cachedUrls()).not.toContain("/_next/static/chunks/missing.js");
  });

  it("у кеші лишаються тільки адреси з білого списку, що б не відкривав користувач", async () => {
    for (const path of ["/orders", "/clients", "/more", "/more/users", "/api/health", "/login"]) {
      await worker.request(path, { mode: "navigate" });
      await worker.request(`${path}?_rsc=1`);
    }
    await worker.request("/_next/static/chunks/x.js");
    const allowed = ["/_next/static/", "/icons/", "/images/", "/offline.html"];
    for (const url of worker.cachedUrls()) {
      expect(allowed.some((prefix) => url.startsWith(prefix))).toBe(true);
    }
  });

  it("команда очистити кеш (наприклад, при виході) порожнить усе сховище", async () => {
    await worker.request("/_next/static/chunks/x.js");
    await worker.run("message", { data: { type: "CLEAR_CACHES" } });
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("при оновленні видаляє старі кеші й перебирає керування сторінками", async () => {
    worker.cacheStorage.set("icelab-static-v0", new Map());
    await worker.run("activate");
    expect([...worker.cacheStorage.keys()]).toEqual(["icelab-static-v1"]);
    expect(worker.state.claimed).toBe(true);
  });
});
