"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseBoxCode } from "@/server/box-rules";
import type { BoxEventOutcome, BoxIssueOrder } from "@/server/boxes";
import {
  counterLabel,
  entryFromOutcome,
  isRepeatScan,
  pushEntry,
  type ScanEntry,
  type ScanMode,
} from "@/utils/scanSession";
import { cn } from "@/utils/cn";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";

interface BoxScannerProps {
  orders: BoxIssueOrder[];
  /** Замовлення, обране за посиланням з картки цеху. */
  initialOrderId: string | null;
}

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

/**
 * Сканер боксів (B9, ТЗ 6.7, D107, D110): режим «Видача» (спершу замовлення) чи «Повернення»,
 * камера (дозвіл питається за натисканням), ручний ввід коду, рядок про кожен скан і лічильник
 * «3 з 4». Відповідь приходить одразу з сервера; офлайн-черга додається в наступному PR.
 */
export default function BoxScanner({ orders, initialOrderId }: BoxScannerProps) {
  const [mode, setMode] = useState<ScanMode>("issue");
  const [orderId, setOrderId] = useState(initialOrderId ?? "");
  const [issued, setIssued] = useState<Record<string, number>>(
    Object.fromEntries(orders.map((o) => [o.id, o.issued])),
  );
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState<"off" | "on" | "error">("off");
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  // Режим і замовлення читає колбек камери, який створюється один раз: тому в посиланні.
  const stateRef = useRef({ mode, orderId });
  useEffect(() => {
    stateRef.current = { mode, orderId };
  }, [mode, orderId]);

  const order = orders.find((o) => o.id === orderId) ?? null;

  const submit = useCallback(async (raw: string) => {
    const code = parseBoxCode(raw);
    const now = Date.now();
    if (!code) {
      beep("error");
      setFlash("error");
      setEntries((list) =>
        pushEntry(list, {
          id: `${now}`,
          code: raw.slice(0, 20),
          result: "error",
          message: "Це не наклейка IceLab.",
        }),
      );
      return;
    }
    if (isRepeatScan(lastRef.current, code, now)) return;
    lastRef.current = { code, at: now };
    const { mode: currentMode, orderId: currentOrder } = stateRef.current;
    if (currentMode === "issue" && !currentOrder) {
      beep("error");
      setFlash("error");
      setEntries((list) =>
        pushEntry(list, {
          id: `${now}`,
          code,
          result: "error",
          message: "Спершу оберіть замовлення.",
        }),
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/boxes/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              code,
              action: currentMode,
              orderId: currentMode === "issue" ? currentOrder : undefined,
              occurredAt: new Date(now).toISOString(),
              deviceQueueId: crypto.randomUUID(),
            },
          ],
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        results?: BoxEventOutcome[];
        error?: string;
      } | null;
      const outcome = data?.results?.[0];
      const entry = outcome
        ? entryFromOutcome(`${now}`, outcome)
        : {
            id: `${now}`,
            code,
            result: "error" as const,
            message: data?.error ?? "Не вдалося зв'язатися з сервером.",
          };
      if (outcome && outcome.result !== "error" && !outcome.duplicate && currentMode === "issue") {
        setIssued((map) => ({ ...map, [currentOrder]: (map[currentOrder] ?? 0) + 1 }));
      }
      beep(entry.result === "error" ? "error" : "ok");
      setFlash(entry.result === "error" ? "error" : "ok");
      setEntries((list) => pushEntry(list, entry));
    } catch {
      beep("error");
      setFlash("error");
      setEntries((list) =>
        pushEntry(list, {
          id: `${now}`,
          code,
          result: "error",
          message: "Немає зв'язку. Повторіть скан.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 400);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => () => stopRef.current?.(), []);

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

  return (
    <div className="flex max-w-3xl flex-col gap-4">
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
        orders.length === 0 ? (
          <Notification variant="info">
            На сьогодні немає замовлень «У виробництві» чи «Запаковано». Видача можлива лише до них.
          </Notification>
        ) : (
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
        <MainButton type="submit" variant="outline" isLoading={busy} loadingText="Записуємо…">
          Записати
        </MainButton>
      </form>

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
      <Link href="/boxes" className="text-body font-semibold text-blue">
        До реєстру
      </Link>
    </div>
  );
}
