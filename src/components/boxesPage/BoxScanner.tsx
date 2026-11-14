"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseBoxCode } from "@/server/box-rules";
import type { BoxIssueOrder } from "@/server/boxes";
import { cn } from "@/utils/cn";
import {
  flushQueue,
  newQueueItem,
  retryItem,
  summarizeQueue,
  type QueueItem,
  type QueueStore,
  type SendBatch,
  type SendOutcome,
} from "@/utils/scanQueue";
import { openScanStores, type ScanMetaStore } from "@/utils/scanQueueDb";
import {
  counterLabel,
  entryFromOutcome,
  isRepeatScan,
  pushEntry,
  type ScanEntry,
  type ScanMode,
} from "@/utils/scanSession";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";

/** Короткий сигнал: різна висота для успіху й помилки. Звук і спалах є на всіх телефонах. */
function beep(kind: "ok" | "error") {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio = new Context();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = kind === "ok" ? 880 : 220;
    oscillator.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + (kind === "ok" ? 0.12 : 0.35));
    oscillator.onended = () => void audio.close();
  } catch {
    // Звуку немає: лишається спалах і рядок.
  }
  // Вібрація лише на Android (iPhone у Safari її не дає, D110).
  navigator.vibrate?.(kind === "ok" ? 60 : [120, 60, 120]);
}

/** Черга в пам'яті, якщо IndexedDB недоступний (приватний режим): працює, доки сторінка відкрита. */
function memoryQueue(): QueueStore {
  const items = new Map<string, QueueItem>();
  return {
    all: async () => [...items.values()],
    put: async (item) => void items.set(item.queueId, item),
    remove: async (id) => void items.delete(id),
  };
}

/** Відправка пакета на сервер. Будь-яка відповідь не 2xx це «не вдалося»: скани лишаються в черзі. */
const sendBatch: SendBatch = async (items) => {
  const response = await fetch("/api/boxes/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      events: items.map((item) => ({
        code: item.code,
        action: item.action,
        orderId: item.orderId ?? undefined,
        occurredAt: item.occurredAt,
        deviceQueueId: item.queueId,
      })),
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { results: SendOutcome[] };
  return data.results;
};

type OrdersSource = "live" | "cached" | "none";

/**
 * Сканер боксів (B9, ТЗ 6.7, §9, D107, D110, D112): режим «Видача» чи «Повернення», камера (дозвіл
 * питається за натисканням), ручний ввід коду, рядок про кожен скан і лічильник «3 з 4». Кожен
 * скан спершу пишеться в чергу на телефоні, потім летить на сервер: без зв'язку він лишається в
 * черзі й відправляється сам, коли зв'язок з'явиться.
 */
export default function BoxScanner() {
  const [mode, setMode] = useState<ScanMode>("issue");
  const [orders, setOrders] = useState<BoxIssueOrder[]>([]);
  const [ordersSource, setOrdersSource] = useState<OrdersSource>("none");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderId, setOrderId] = useState("");
  const [issued, setIssued] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState<"off" | "on" | "error">("off");
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const storeRef = useRef<{ queue: QueueStore; meta: ScanMetaStore | null } | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const flushing = useRef(false);
  // Режим і замовлення читає колбек камери, який створюється один раз: тому в посиланні.
  const stateRef = useRef({ mode, orderId });
  useEffect(() => {
    stateRef.current = { mode, orderId };
  }, [mode, orderId]);
  const orderOfScan = useRef(new Map<string, string>());

  const summary = summarizeQueue(queueItems);
  const order = orders.find((o) => o.id === orderId) ?? null;

  const refreshQueue = useCallback(async () => {
    const store = storeRef.current;
    if (store) setQueueItems(await store.queue.all());
  }, []);

  /** Відправляє чергу й оновлює рядки скану відповідями сервера. */
  const sync = useCallback(async () => {
    const store = storeRef.current;
    if (!store || flushing.current) return;
    flushing.current = true;
    setSyncing(true);
    try {
      const { outcomes } = await flushQueue(store.queue, sendBatch);
      for (const outcome of outcomes) {
        const queueId = outcome.queueId ?? "";
        setEntries((list) =>
          list.map((entry) => (entry.id === queueId ? entryFromOutcome(queueId, outcome) : entry)),
        );
        if (outcome.result === "error") {
          // Скан не прийнято: знімаємо його з лічильника замовлення.
          const failedOrder = orderOfScan.current.get(queueId);
          if (failedOrder)
            setIssued((map) => ({
              ...map,
              [failedOrder]: Math.max(0, (map[failedOrder] ?? 1) - 1),
            }));
        }
        orderOfScan.current.delete(queueId);
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
      await refreshQueue();
    }
  }, [refreshQueue]);

  // Сховище, список замовлень і мережа.
  useEffect(() => {
    let cancelled = false;
    readyRef.current = (async () => {
      setOnline(navigator.onLine);
      try {
        const stores = await openScanStores();
        storeRef.current = { queue: stores.queue, meta: stores.meta };
      } catch {
        storeRef.current = { queue: memoryQueue(), meta: null };
        setStorageWarning(true);
      }
      if (cancelled) return;
      await refreshQueue();

      let fresh: BoxIssueOrder[] | null = null;
      try {
        const response = await fetch("/api/boxes/orders");
        if (response.ok) {
          const data = (await response.json()) as { date: string; orders: BoxIssueOrder[] };
          fresh = data.orders;
          await storeRef.current.meta?.set("orders", data);
        }
      } catch {
        // Без зв'язку візьмемо збережений список.
      }
      if (cancelled) return;
      let list = fresh;
      let source: OrdersSource = fresh ? "live" : "none";
      if (!list) {
        const cached = await storeRef.current.meta?.get<{ date: string; orders: BoxIssueOrder[] }>(
          "orders",
        );
        if (cached) {
          list = cached.orders;
          source = "cached";
        }
      }
      setOrders(list ?? []);
      setOrdersSource(source);
      setIssued(Object.fromEntries((list ?? []).map((o) => [o.id, o.issued])));
      const requested = new URLSearchParams(window.location.search).get("order");
      if (requested && list?.some((o) => o.id === requested)) setOrderId(requested);
      setOrdersLoading(false);
      void sync();
    })();

    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Запасна спроба, якщо подія «online» не прийшла (слабкий сигнал).
    const timer = setInterval(() => void sync(), 30_000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(timer);
    };
  }, [refreshQueue, sync]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 400);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => () => stopRef.current?.(), []);

  const submit = useCallback(
    async (raw: string) => {
      const code = parseBoxCode(raw);
      const now = Date.now();
      const fail = (message: string, shown = code ?? raw.slice(0, 20)) => {
        beep("error");
        setFlash("error");
        setEntries((list) =>
          pushEntry(list, { id: `e${now}`, code: shown, result: "error", message }),
        );
      };
      if (!code) return fail("Це не наклейка IceLab.");
      if (isRepeatScan(lastRef.current, code, now)) return;
      lastRef.current = { code, at: now };
      const { mode: currentMode, orderId: currentOrder } = stateRef.current;
      if (currentMode === "issue" && !currentOrder) return fail("Спершу оберіть замовлення.");
      await readyRef.current;
      const store = storeRef.current;
      if (!store) return fail("Сховище скану не готове. Повторіть.");

      const item = newQueueItem(
        { code, action: currentMode, orderId: currentMode === "issue" ? currentOrder : null },
        new Date(now),
        crypto.randomUUID(),
      );
      // Спершу на телефон, потім на сервер: скан не губиться, навіть якщо зв'язок зникне.
      await store.queue.put(item);
      beep("ok");
      setFlash("ok");
      setEntries((list) =>
        pushEntry(list, {
          id: item.queueId,
          code,
          result: "ok",
          message: "Збережено, відправляємо…",
        }),
      );
      if (currentMode === "issue") {
        orderOfScan.current.set(item.queueId, currentOrder);
        setIssued((map) => ({ ...map, [currentOrder]: (map[currentOrder] ?? 0) + 1 }));
      }
      await refreshQueue();
      if (navigator.onLine) await sync();
      else {
        setEntries((list) =>
          list.map((entry) =>
            entry.id === item.queueId
              ? { ...entry, message: "Збережено, у черзі. Відправиться, коли буде зв'язок." }
              : entry,
          ),
        );
      }
    },
    [refreshQueue, sync],
  );

  async function startCamera() {
    try {
      // Бібліотека велика: вантажимо її лише тоді, коли камеру справді вмикають (D110).
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) void submit(result.getText());
        },
      );
      stopRef.current = () => controls.stop();
      setCamera("on");
    } catch {
      setCamera("error");
    }
  }

  function stopCamera() {
    stopRef.current?.();
    stopRef.current = null;
    setCamera("off");
  }

  const attention = queueItems.filter((item) => item.state === "attention");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 text-navy">Сканер боксів</h1>
        <Link href="/boxes" className="text-body font-semibold text-blue">
          До реєстру
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex min-h-8 items-center rounded-full px-3 text-body font-semibold",
            online
              ? "bg-status-packed text-status-packed-text"
              : "bg-status-in-production text-status-in-production-text",
          )}
        >
          {online ? "Є зв'язок" : "Немає зв'язку"}
        </span>
        {summary.pending > 0 ? (
          <>
            <Text variant="label">Не відправлено: {summary.pending}</Text>
            <MainButton
              fullWidth={false}
              size="sm"
              variant="outline"
              onClick={() => void sync()}
              isLoading={syncing}
              loadingText="Відправляємо…"
            >
              Відправити зараз
            </MainButton>
          </>
        ) : null}
      </div>

      {!online ? (
        <Notification variant="warning">
          Немає зв&apos;язку. Скани зберігаються на телефоні й відправляться самі, коли він
          з&apos;явиться. Не закривайте застосунок, доки є «Не відправлено».
        </Notification>
      ) : null}
      {storageWarning ? (
        <Notification variant="warning">
          Телефон не дає зберігати скани надовго. Тримайте сторінку відкритою, доки скани не
          відправлені.
        </Notification>
      ) : null}

      <div role="group" aria-label="Режим" className="grid grid-cols-2 gap-2">
        {(["issue", "return"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "min-h-13 rounded-field border px-4 text-lead font-bold transition",
              mode === value
                ? "border-transparent bg-navy text-white"
                : "border-grey-field bg-grey-light text-navy",
            )}
          >
            {value === "issue" ? "Видача" : "Повернення"}
          </button>
        ))}
      </div>

      {mode === "issue" ? (
        ordersLoading ? (
          <Text variant="muted">Завантажуємо замовлення…</Text>
        ) : orders.length === 0 ? (
          <Notification variant="info">
            {ordersSource === "none" && !online
              ? "Немає зв'язку, а збереженого списку замовлень немає. Видача стане можливою, коли зв'язок з'явиться."
              : "На сьогодні немає замовлень «У виробництві» чи «Запаковано». Видача можлива лише до них."}
          </Notification>
        ) : (
          <>
            {ordersSource === "cached" ? (
              <Notification variant="info">
                Показано збережений список замовлень: зв&apos;язку немає.
              </Notification>
            ) : null}
            <CustomizedSelect
              name="order"
              label="Замовлення"
              options={[
                { value: "", label: "Оберіть замовлення" },
                ...orders.map((o) => ({
                  value: o.id,
                  label: `№ ${o.number ?? "—"} · ${o.clientName}${o.needed ? ` · ${counterLabel(issued[o.id] ?? 0, o.needed)}` : ""}`,
                })),
              ]}
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
            />
          </>
        )
      ) : (
        <Text variant="muted">Скануйте бокс, який привіз клієнт: систему сама знайде клієнта.</Text>
      )}

      {mode === "issue" && order ? (
        <Text
          variant="kpi"
          className={cn(
            order.needed > 0 &&
              (issued[order.id] ?? 0) >= order.needed &&
              "text-status-packed-text",
          )}
        >
          {counterLabel(issued[order.id] ?? 0, order.needed)}
        </Text>
      ) : null}

      <div
        className={cn(
          "overflow-hidden rounded-card border-4 bg-navy transition",
          flash === "ok"
            ? "border-status-packed-text"
            : flash === "error"
              ? "border-red-error"
              : "border-transparent",
        )}
      >
        <video
          ref={videoRef}
          className={cn("aspect-video w-full object-cover", camera !== "on" && "hidden")}
          muted
          playsInline
        />
        {camera !== "on" ? (
          <div className="flex aspect-video items-center justify-center p-4 text-center">
            <Text className="text-white">
              {camera === "error"
                ? "Камеру не вдалося увімкнути. Дозвольте доступ у налаштуваннях або введіть код вручну."
                : "Камера вимкнена"}
            </Text>
          </div>
        ) : null}
      </div>
      <MainButton
        variant={camera === "on" ? "outline" : "fill"}
        onClick={camera === "on" ? stopCamera : startCamera}
      >
        {camera === "on" ? "Вимкнути камеру" : "Увімкнути камеру"}
      </MainButton>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (manual.trim()) void submit(manual);
          setManual("");
        }}
      >
        <CustomizedInput
          name="manualCode"
          label="Код вручну"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="K-0012"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          hint="Якщо камера не читає наклейку."
        />
        <MainButton type="submit" variant="outline">
          Записати
        </MainButton>
      </form>

      {attention.length > 0 ? (
        <section aria-label="Потребують уваги" className="flex flex-col gap-2">
          <Text variant="label">Потребують уваги</Text>
          {attention.map((item) => (
            <Notification key={item.queueId} variant="error">
              <div className="flex flex-col gap-2">
                <span>
                  <strong>{item.code}</strong>: {item.message}
                </span>
                <div className="flex gap-2">
                  <MainButton
                    fullWidth={false}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const store = storeRef.current;
                      if (!store) return;
                      await retryItem(store.queue, item.queueId);
                      await refreshQueue();
                      void sync();
                    }}
                  >
                    Повторити
                  </MainButton>
                  <MainButton
                    fullWidth={false}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await storeRef.current?.queue.remove(item.queueId);
                      await refreshQueue();
                    }}
                  >
                    Видалити
                  </MainButton>
                </div>
              </div>
            </Notification>
          ))}
        </section>
      ) : null}

      <section aria-label="Скани" aria-live="polite" className="flex flex-col gap-2">
        {entries.map((entry) => (
          <Notification
            key={entry.id}
            variant={
              entry.result === "ok" ? "success" : entry.result === "warning" ? "warning" : "error"
            }
          >
            <strong>{entry.code}</strong>: {entry.message}
          </Notification>
        ))}
      </section>
    </div>
  );
}
