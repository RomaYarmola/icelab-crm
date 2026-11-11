import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SubTitleProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

/** Підзаголовок (h3): назва картки, групи полів. Розмір: text-h3 з globals.css. */
export default function SubTitle({ children, className = "", id }: SubTitleProps) {
  return (
    <h3 id={id} className={cn("text-h3 text-navy", className)}>
      {children}
    </h3>
  );
}
