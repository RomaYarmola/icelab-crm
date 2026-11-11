import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { ButtonSize, ButtonVariant, getButtonClassName } from "./buttonStyles";

interface ButtonLinkProps {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isExternal?: boolean;
  icon?: ReactNode;
  className?: string;
}

/** Посилання, яке виглядає як кнопка (той самий вигляд, що в MainButton). */
export default function ButtonLink({
  href,
  children,
  variant = "fill",
  size = "md",
  fullWidth = false,
  isExternal = false,
  icon,
  className,
}: ButtonLinkProps) {
  const classes = cn(getButtonClassName({ variant, size, fullWidth }), className);

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {icon}
        <span>{children}</span>
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
