import { cn } from "@/utils/cn";

export type ButtonVariant = "fill" | "accent" | "outline" | "ghost";
export type ButtonSize = "md" | "sm";

interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/*
  Єдині стилі кнопок для <button> (MainButton) і посилань у вигляді кнопки (ButtonLink).
  Hover лише від брейкпоінта lg (на дотик «залипає»), як у nbyg-front. Натиснення:
  active:scale-[98%]. Фокус бере глобальний :focus-visible з globals.css.
*/
const base =
  "relative inline-flex items-center justify-center gap-2 rounded-field text-lead font-bold text-center transition will-change-transform active:scale-[98%] disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  fill: "border border-transparent bg-navy text-white lg:hover:bg-logo-blue",
  accent: "border border-transparent bg-blue text-white lg:hover:bg-navy",
  outline: "border border-grey-field bg-grey-light text-navy lg:hover:bg-grey-border",
  ghost: "border border-transparent bg-transparent text-navy lg:hover:bg-grey-light",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-13 px-6",
  sm: "min-h-11 px-4",
};

export function getButtonClassName({
  variant = "fill",
  size = "md",
  fullWidth = false,
}: ButtonClassNameOptions = {}): string {
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full");
}
