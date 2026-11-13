"use client";

import { useState } from "react";
import { XLSX_CONTENT_TYPE } from "@/constants/export";
import type { ButtonSize, ButtonVariant } from "../buttons/buttonStyles";
import MainButton from "../buttons/MainButton";
import DownloadIcon from "../icons/DownloadIcon";
import Notification from "../notification/Notification";
import Text from "../texts/Text";

interface ExportButtonProps {
  /** Який список вивантажуємо: адреса `/api/export/<список>`. */
  list: "orders" | "clients" | "cash" | "all";
  /** Текст кнопки. */
  children?: string;
  /** Що потрапить у файл: короткий рядок під кнопкою (`INLINE_HINTS`). */
  hint?: string;
  /** З фільтрами сторінки: додаємо до адреси поточні параметри (`?q=…&status=…`). */
  withPageFilters?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; rows: number }
  | { status: "error"; message: string };

const FALLBACK_NAME = "icelab-export.xlsx";

function fileNameOf(response: Response): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  return /filename="([^"]+)"/.exec(header)?.[1] ?? FALLBACK_NAME;
}

/**
 * Кнопка «Експорт у Excel» (B8, D92). Файл вантажимо запитом, а не посиланням, щоб помилку («надто
 * багато рядків», «немає прав», «увійдіть знову») показати тут, а не на білій сторінці з текстом.
 * Фільтри беремо з адреси сторінки: у файлі те, що на екрані.
 */
export default function ExportButton({
  list,
  children = "Експорт у Excel",
  hint,
  withPageFilters = true,
  variant = "outline",
  size = "sm",
  className,
}: ExportButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function download() {
    setState({ status: "loading" });
    try {
      const query = withPageFilters ? window.location.search : "";
      const response = await fetch(`/api/export/${list}${query}`, { credentials: "same-origin" });
      if (!response.ok) {
        const text = response.status === 422 ? await response.text() : "";
        setState({
          status: "error",
          message:
            response.status === 403
              ? "Недостатньо прав для експорту."
              : text || "Не вдалося підготувати файл. Спробуйте ще раз.",
        });
        return;
      }
      // Сесія завершилась: сервер повів на сторінку входу, а це не файл.
      if (!response.headers.get("Content-Type")?.startsWith(XLSX_CONTENT_TYPE)) {
        setState({ status: "error", message: "Сесія завершилась. Увійдіть знову й повторіть." });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameOf(response);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ status: "ok", rows: Number(response.headers.get("X-Export-Rows") ?? 0) });
    } catch {
      setState({ status: "error", message: "Немає зв'язку. Перевірте інтернет і повторіть." });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <MainButton
        variant={variant}
        size={size}
        fullWidth={false}
        icon={<DownloadIcon className="size-5" />}
        isLoading={state.status === "loading"}
        loadingText="Готуємо файл…"
        onClick={download}
        className={className}
      >
        {children}
      </MainButton>
      {hint && state.status === "idle" ? <Text variant="muted">{hint}</Text> : null}
      {state.status === "error" ? (
        <Notification variant="error">{state.message}</Notification>
      ) : null}
      {state.status === "ok" ? (
        <Notification variant="success">
          {state.rows === 0
            ? "Файл збережено: за цими фільтрами нічого немає, у ньому лише заголовки."
            : `Файл збережено. Рядків: ${state.rows}.`}
        </Notification>
      ) : null}
    </div>
  );
}
