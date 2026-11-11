import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** Підпис для екранних читалок. Кнопка без тексту без нього незрозуміла. */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Кругла кнопка з іконкою (зона натискання не менша за 44 px). */
export default function IconButton({
  label,
  children,
  type = "button",
  className = "",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-full text-navy transition active:scale-[98%] disabled:pointer-events-none disabled:opacity-60 lg:hover:bg-grey-light",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
