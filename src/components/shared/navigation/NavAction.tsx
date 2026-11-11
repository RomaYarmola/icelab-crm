import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";
import { popupItemClassName, sideItemClassName } from "./navItemStyles";

interface NavActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children: ReactNode;
  icon: ReactNode;
  /** `popup`: у списку попапа (розмір як у нижній панелі), `side`: у бічній панелі комп'ютера. */
  variant?: "popup" | "side";
  /** Вибраний пункт списку (наприклад, поточна локація): синій на світлому тлі, шрифт той самий. */
  isActive?: boolean;
  className?: string;
}

/** Дія в списку меню (наприклад, «Вийти»): виглядає як пункт меню, але це кнопка. */
export default function NavAction({
  children,
  icon,
  variant = "popup",
  isActive = false,
  type = "button",
  className,
  ...rest
}: NavActionProps) {
  const itemClassName =
    variant === "popup" ? popupItemClassName(isActive) : sideItemClassName(isActive);

  return (
    <button type={type} className={cn(itemClassName, className)} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
