import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import ChevronIcon from "../icons/ChevronIcon";

interface DisclosureProps {
  /** Підпис кнопки, що розкриває блок. */
  summary: ReactNode;
  children: ReactNode;
  /** Розкрито від початку (наприклад, коли є вибрані фільтри). */
  defaultOpen?: boolean;
  /** `outline`: кнопка з рамкою (дія: «Додати контакт»), `plain`: без рамки (історія, деталі). */
  variant?: "outline" | "plain";
  className?: string;
}

/**
 * Блок, що розкривається за натисненням (нативний `<details>`: працює з клавіатури, не потребує
 * скриптів). Кнопка висотою від 44 px зі стрілкою, що розвертається при розкритті.
 */
export default function Disclosure({
  summary,
  children,
  defaultOpen = false,
  variant = "outline",
  className,
}: DisclosureProps) {
  return (
    <details open={defaultOpen} className={cn("group", className)}>
      <summary
        className={cn(
          "flex min-h-11 list-none items-center justify-between gap-3 rounded-field text-body font-semibold text-navy transition select-none marker:hidden active:scale-[99%] [&::-webkit-details-marker]:hidden",
          variant === "outline"
            ? "border border-grey-field bg-grey-light px-4 lg:hover:bg-grey-border"
            : "px-0 text-grey-text lg:hover:text-navy",
        )}
      >
        <span className="min-w-0">{summary}</span>
        <ChevronIcon className="size-5 shrink-0 text-grey-text transition group-open:rotate-180" />
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}
