import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface PageTitleProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

/** Заголовок сторінки (h1). Один на сторінку. Розмір: text-h1 з globals.css. */
export default function PageTitle({ children, className = "", id }: PageTitleProps) {
  return (
    <h1 id={id} className={cn("text-h1 text-navy", className)}>
      {children}
    </h1>
  );
}
