"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ShipmentStepResult } from "@/app/(app)/shipments/actions";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/constants/constants";
import type { ShipmentDayRow } from "@/server/np/shipment-day";
import MainButton from "../shared/buttons/MainButton";
import Tag from "../shared/chips/Tag";
import Checkbox from "../shared/customizedInput/Checkbox";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import type { ShipmentDayActions } from "./shipmentTypes";

/** Скільки замовлень створюємо одночасно (ТЗ 8.4: не більше двох). */
const CONCURRENCY = 2;

interface ShipmentDayListProps {
  rows: ShipmentDayRow[];
  actions: ShipmentDayActions;
}

/**
 * Список замовлень Нової Пошти на день з галочками. «Створити ТТН для обраних» веде чергу сам: по
 * одному замовленню на запит, двоє одночасно, зі смугою прогресу; помилка одного не зупиняє решту.
 * Після цього видно таблицю результатів і «Завантажити стікери одним PDF» для всіх накладних дня.
 */
export default function ShipmentDayList({ rows, actions }: ShipmentDayListProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ShipmentStepResult[]>([]);
  const [stickerState, setStickerState] = useState<
    | { status: "idle" }
    | { status: "loading"; done: number; total: number }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const selectable = rows.filter((row) => row.selectable);
  const byId = new Map(rows.map((row) => [row.orderId, row]));
  // Накладні, для яких можна завантажити стікер: уже створені (з бази) і щойно створені.
  const stickerIds = [
    ...new Set([
      ...rows.filter((row) => row.shipment?.ttnNumber).map((row) => row.shipment!.id),
      ...results.flatMap((result) => (result.ok ? [result.shipmentId] : [])),
    ]),
  ];

  function toggle(orderId: string, isOn: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (isOn) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  async function run() {
    const queue = [...selected].filter((id) => byId.get(id)?.selectable);
    if (queue.length === 0 || isRunning) return;
    setIsRunning(true);
    setResults([]);
    setProgress({ done: 0, total: queue.length });
    const collected: ShipmentStepResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const orderId = queue[next++]!;
        let result: ShipmentStepResult;
        try {
          result = await actions.createStep(orderId);
        } catch {
          result = { ok: false, orderId, message: "Немає зв'язку із сервером. Спробуйте ще раз." };
        }
        collected.push(result);
        setResults([...collected]);
        setProgress((current) => ({ ...current, done: current.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setSelected(new Set());
    setIsRunning(false);
    router.refresh();
  }

  async function downloadStickers() {
    setStickerState({ status: "loading", done: 0, total: stickerIds.length });
    try {
      // Бібліотеку склеювання вантажимо лише тут, щоб не обтяжувати решту застосунку.
      const { PDFDocument } = await import("pdf-lib");
      const merged = await PDFDocument.create();
      let index = 0;
      let done = 0;
      const worker = async () => {
        while (index < stickerIds.length) {
          const position = index++;
          const response = await fetch(`/api/shipments/${stickerIds[position]}/sticker`);
          if (!response.ok) throw new Error(await response.text());
          pages[position] = new Uint8Array(await response.arrayBuffer());
          done += 1;
          setStickerState({ status: "loading", done, total: stickerIds.length });
        }
      };
      const pages: Uint8Array[] = [];
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stickerIds.length) }, worker));
      for (const bytes of pages) {
        const document = await PDFDocument.load(bytes);
        const copied = await merged.copyPages(document, document.getPageIndices());
        copied.forEach((page) => merged.addPage(page));
      }
      const blob = new Blob([new Uint8Array(await merged.save())], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStickerState({ status: "idle" });
    } catch (error) {
      setStickerState({
        status: "error",
        message:
          error instanceof Error && error.message ? error.message : "Не вдалося зібрати стікери.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <MainButton
          onClick={run}
          disabled={selected.size === 0}
          isLoading={isRunning}
          loadingText={`Створюємо ${progress.done} з ${progress.total}…`}
          className="lg:w-auto"
          fullWidth={false}
        >
          {selected.size > 0
            ? `Створити ТТН для обраних (${selected.size})`
            : "Створити ТТН для обраних"}
        </MainButton>
        {selectable.length > 0 ? (
          <MainButton
            variant="outline"
            fullWidth={false}
            disabled={isRunning}
            onClick={() =>
              setSelected(
                selected.size === selectable.length
                  ? new Set()
                  : new Set(selectable.map((row) => row.orderId)),
              )
            }
          >
            {selected.size === selectable.length
              ? "Зняти вибір"
              : `Обрати всі (${selectable.length})`}
          </MainButton>
        ) : null}
        {stickerIds.length > 0 ? (
          <MainButton
            variant="outline"
            fullWidth={false}
            disabled={isRunning || stickerState.status === "loading"}
            isLoading={stickerState.status === "loading"}
            loadingText={
              stickerState.status === "loading"
                ? `Стікери ${stickerState.done} з ${stickerState.total}…`
                : undefined
            }
            onClick={downloadStickers}
          >
            {`Завантажити стікери одним PDF (${stickerIds.length})`}
          </MainButton>
        ) : null}
      </div>
      {stickerState.status === "error" ? (
        <Notification variant="error">{stickerState.message}</Notification>
      ) : null}

      {isRunning ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label="Прогрес створення накладних"
          className="h-3 w-full overflow-hidden rounded-full bg-grey-light"
        >
          <div
            className="h-full bg-navy transition-all"
            style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
          />
        </div>
      ) : null}

      {results.length > 0 ? (
        <section aria-labelledby="shipment-results" className="flex flex-col gap-2">
          <SectionTitle id="shipment-results">Результат</SectionTitle>
          <ul className="flex flex-col gap-2">
            {results.map((result) => {
              const row = byId.get(result.orderId);
              return (
                <li
                  key={result.orderId}
                  className="flex flex-col gap-1 rounded-card border border-grey-field bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Text variant="label" className="min-w-0 break-words">
                      {row?.clientName ?? "Замовлення"}
                      {row?.number ? ` · № ${row.number}` : ""}
                    </Text>
                    <Tag className="shrink-0">{result.ok ? "Створено" : "Помилка"}</Tag>
                  </div>
                  <Text variant={result.ok ? undefined : "muted"}>
                    {result.ok ? `ТТН ${result.ttnNumber}` : result.message}
                  </Text>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.orderId}
            className="flex flex-col gap-2 rounded-card border border-grey-field bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/orders/${row.orderId}`}
                className="min-w-0 text-h2 break-words text-navy underline-offset-2 lg:hover:underline"
              >
                {row.clientName}
                {row.number ? ` · № ${row.number}` : ""}
              </Link>
              <Tag className="shrink-0">
                {row.shipment
                  ? row.shipment.statusLabel
                  : ORDER_STATUS_LABELS[row.status as OrderStatus]}
              </Tag>
            </div>
            <Text variant="muted">{row.addressText}</Text>
            {row.recipient ? <Text variant="muted">{row.recipient}</Text> : null}
            <Text variant="muted">
              {row.weightKg.toLocaleString("uk-UA")} кг, місць {row.seats}
            </Text>
            {row.shipment?.ttnNumber ? (
              <Text variant="label">ТТН {row.shipment.ttnNumber}</Text>
            ) : null}
            {row.shipment?.errorText && !row.shipment.ttnNumber ? (
              <Notification variant="error">{row.shipment.errorText}</Notification>
            ) : null}
            {row.shipment && ["refused", "returning", "returned"].includes(row.shipment.status) ? (
              <Notification variant="warning">
                Посилка повертається або одержувач відмовився. Зв’яжіться з клієнтом.
              </Notification>
            ) : null}
            {row.blockers.length > 0 ? (
              <Notification variant={row.needsAddress ? "warning" : "info"}>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {row.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
                {row.needsAddress ? (
                  <Link
                    href={`/clients/${row.clientId}?tab=addresses`}
                    className="mt-2 inline-block font-semibold underline"
                  >
                    Підібрати адресу
                  </Link>
                ) : null}
              </Notification>
            ) : null}
            {row.selectable ? (
              <Checkbox
                name={`order-${row.orderId}`}
                label="Створити ТТН"
                checked={selected.has(row.orderId)}
                disabled={isRunning}
                onChange={(event) => toggle(row.orderId, event.target.checked)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
