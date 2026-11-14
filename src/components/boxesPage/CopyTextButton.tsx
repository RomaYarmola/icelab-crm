"use client";

import { useState } from "react";
import MainButton from "../shared/buttons/MainButton";

interface CopyTextButtonProps {
  text: string;
  children: string;
}

/**
 * Кнопка «копіювати текст» (для нагадування про борг): менеджер вставляє його в месенджер сам.
 * Якщо буфер обміну недоступний, текст показується під кнопкою, його можна виділити вручну.
 */
export default function CopyTextButton({ text, children }: CopyTextButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("manual");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <MainButton variant="outline" size="sm" fullWidth={false} onClick={copy}>
        {state === "copied" ? "Скопійовано" : children}
      </MainButton>
      {state === "manual" ? (
        <p className="rounded-card border border-grey-field bg-grey-light p-3 text-body text-navy select-all">
          {text}
        </p>
      ) : null}
    </div>
  );
}
