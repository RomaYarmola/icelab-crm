import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface CardProps {
  children: ReactNode;
  as?: "div" | "section" | "article" | "li";
  /** Картка клікабельна: при наведенні (від lg) підсвічує рамку. */
  interactive?: boolean;
  className?: string;
}

/** Картка зі світло-сірим тлом: елемент списку, блок зі статистикою, група полів. */
export default function Card({
  children,
  as: Tag = "div",
  interactive = false,
  className = "",
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-grey-border bg-grey-light p-4",
        interactive && "cursor-pointer transition lg:hover:border-grey-field",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
