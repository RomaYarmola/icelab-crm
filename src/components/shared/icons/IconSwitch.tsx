import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface IconSwitchProps {
  /** Який значок показувати зараз: `true` показує `on`, `false` показує `off`. */
  isOn: boolean;
  on: ReactNode;
  off: ReactNode;
  className?: string;
}

/**
 * Плавна заміна одного значка іншим (наприклад, око і перекреслене око): значки лежать один на
 * одному, і той, що йде, зникає з легким зменшенням, а той, що приходить, з'являється. Ефект
 * єдиний для всього інтерфейсу (клас `transition`, див. `--transition-duration`).
 */
export default function IconSwitch({ isOn, on, off, className = "" }: IconSwitchProps) {
  const layer = "absolute inset-0 flex items-center justify-center transition";

  return (
    <span className={cn("relative inline-block size-6", className)} aria-hidden="true">
      <span className={cn(layer, isOn ? "scale-100 opacity-100" : "scale-75 opacity-0")}>{on}</span>
      <span className={cn(layer, isOn ? "scale-75 opacity-0" : "scale-100 opacity-100")}>
        {off}
      </span>
    </span>
  );
}
