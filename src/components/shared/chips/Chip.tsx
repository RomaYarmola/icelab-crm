import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ChipProps {
  children: ReactNode;
  /** Вибраний фільтр. */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Фільтр-таблетка («Сьогодні», «Вчора»). Висота від 44 px. */
export default function Chip({ children, selected = false, onClick, className = "" }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-2.5 text-body transition active:scale-[98%]",
        selected
          ? "border-navy bg-navy font-semibold text-white lg:hover:bg-logo-blue"
          : "border-grey-field bg-grey-light text-navy lg:hover:bg-grey-border",
        className,
      )}
    >
      {children}
    </button>
  );
}
