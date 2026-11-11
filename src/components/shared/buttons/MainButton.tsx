import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";
import LoaderIcon from "../icons/LoaderIcon";
import { ButtonSize, ButtonVariant, getButtonClassName } from "./buttonStyles";

interface MainButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
  className?: string;
}

/** Основна кнопка. Для переходу за адресою використовуйте ButtonLink з тим самим виглядом. */
export default function MainButton({
  children,
  type = "button",
  variant = "fill",
  size = "md",
  fullWidth = true,
  isLoading = false,
  loadingText = "Зачекайте…",
  icon,
  className,
  disabled,
  ...rest
}: MainButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      className={cn(getButtonClassName({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {isLoading ? <LoaderIcon className="size-5" /> : icon}
      <span>{isLoading ? loadingText : children}</span>
    </button>
  );
}
