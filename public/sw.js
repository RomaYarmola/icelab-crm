/*
  Service worker IceLab CRM (PWA). Робить дві речі:
  1. кешує лише статичні файли (скрипти й стилі Next.js з хешем у назві, значки, логотип), щоб
     застосунок відкривався швидше;
  2. якщо інтернету немає, замість помилки браузера показує сторінку «Немає зв'язку».

  Сторінки з даними, відповіді серверних дій і `/api` НЕ кешуються і не перехоплюються: інакше
  наступний користувач того ж телефона міг би побачити дані попереднього. Тому кешувати можна
  тільки адреси з білого списку нижче, а запити навігації завжди йдуть у мережу.
  Єдиний виняток: сторінка сканера боксів `/scan` (B9, D112). Це нейтральна оболонка без даних
  користувача (замовлення й скани беруться з API та IndexedDB), її кешуємо, щоб сканер відкривався
  без мережі. Мережа в неї на першому місці, кеш лише коли мережі немає.
  Тест: tests/pwa/service-worker.test.ts.
*/
const CACHE_NAME = "icelab-static-v1";
const SCAN_CACHE_NAME = "icelab-scan-v1";
const SCAN_PATH = "/scan";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/images/logo/logo.svg",
  "/images/logo/mark.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/** Адреси, які можна кешувати: лише статичні файли свого сайту. */
function isCacheableStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/images/") ||
      url.pathname === OFFLINE_URL)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== SCAN_CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Оболонка сканера: мережа, а без мережі остання збережена. Редірект на вхід у кеш не кладемо. */
async function scanShell(request, url) {
  const key = url.origin + SCAN_PATH;
  const cache = await caches.open(SCAN_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && response.type === "basic") {
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(key)) || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Сторінка завжди з мережі; лише коли зв'язку немає, показуємо «Немає зв'язку». Саму сторінку
  // в кеш не кладемо.
  if (request.mode === "navigate" && url.pathname === SCAN_PATH) {
    event.respondWith(scanShell(request, url));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Усе інше (дані, RSC-запити, /api) не чіпаємо: браузер іде в мережу сам.
});

// Команда застосунку очистити кеш (наприклад, якщо знадобиться при виході).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
});
