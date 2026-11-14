import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ChipProps {
  children: ReactNode;
  /** Вибраний фільтр. */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Фільтр-таблетка («Сьогодні», «Вчора»). На телефоні компактна (низька, текст дрібніший), а зона
 * натискання лишається від 44 px завдяки невидимому `after`. Від lg звичайна: висота від 44 px.
 */
export default function Chip({ children, selected = false, onClick, className = "" }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative inline-flex min-h-8 items-center rounded-full border px-3 text-caption transition after:absolute after:inset-x-0 after:-inset-y-1.5 active:scale-[98%] lg:min-h-11 lg:px-2.5 lg:text-body lg:after:inset-y-0",
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
