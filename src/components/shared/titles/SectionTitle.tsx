import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SectionTitleProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

/** Заголовок розділу сторінки (h2). Розмір: text-h2 з globals.css. */
export default function SectionTitle({ children, className = "", id }: SectionTitleProps) {
  return (
    <h2 id={id} className={cn("text-h2 text-navy", className)}>
      {children}
    </h2>
  );
}
