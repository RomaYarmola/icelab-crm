import { cn } from "@/utils/cn";

interface FieldClassNameOptions {
  /** Поле з помилкою: червона рамка й тінь. */
  hasError?: boolean;
  /** Багаторядкове поле: вища, з вертикальним відступом. */
  isMultiline?: boolean;
  className?: string;
}

/**
 * Вигляд поля форми: поле вводу, список (select) і багаторядкове поле виглядають однаково.
 * Висота від 50 px, шрифт від 16 px. Фокус: рамка змінює колір на акцентний (той самий, що й тінь,
 * `--color-blue-focus`) і з'являється м'яка тінь `shadow-focus`, товщина рамки не змінюється.
 * Усі значення беруться з токенів у globals.css.
 */
export function getFieldClassName({
  hasError = false,
  isMultiline = false,
  className,
}: FieldClassNameOptions = {}) {
  return cn(
    "w-full rounded-field border bg-white px-4 text-body text-navy placeholder:text-grey-text transition disabled:opacity-60",
    hasError
      ? "border-red-error focus:shadow-focus-error"
      : "border-grey-field focus:border-blue-focus focus:shadow-focus lg:hover:not-focus:border-navy",
    isMultiline ? "min-h-32 resize-y py-3" : "min-h-12.5",
    className,
  );
}
