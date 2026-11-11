import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface TagProps {
  children: ReactNode;
  /** `outline`: контурна «пігулка»; `plain`: просто підпис без рамки (не схожий на кнопку). */
  variant?: "outline" | "plain";
  className?: string;
}

/**
 * Невеликий підпис без дії: локація в шапці, місто, код. Не клікабельний, тож зона натискання
 * 44 px не потрібна: на телефоні він компактний, з lg звичайного розміру. Клікабельний аналог
 * (вибір локації) це `LocationSelect`.
 */
export default function Tag({ children, variant = "outline", className = "" }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center text-caption font-semibold whitespace-nowrap lg:min-h-11",
        variant === "outline"
          ? "rounded-full border border-grey-field px-3 text-navy lg:px-4"
          : "text-grey-text",
        className,
      )}
    >
      {children}
    </span>
  );
}
