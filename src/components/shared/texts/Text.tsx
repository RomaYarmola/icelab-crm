import { ReactNode } from "react";
import { cn } from "@/utils/cn";

type TextVariant = "body" | "muted" | "lead" | "label" | "error" | "kpi";

interface TextProps {
  children: ReactNode;
  variant?: TextVariant;
  as?: "p" | "span" | "div";
  className?: string;
  id?: string;
}

const variants: Record<TextVariant, string> = {
  body: "text-body text-navy",
  muted: "text-body text-grey-text",
  lead: "text-lead text-navy",
  label: "text-body font-semibold text-navy",
  error: "text-body text-red-error",
  kpi: "text-kpi text-navy",
};

/** Основний текст. Усі варіанти мають розмір від 16 px (вимога ТЗ). */
export default function Text({
  children,
  variant = "body",
  as: Tag = "p",
  className = "",
  id,
}: TextProps) {
  return (
    <Tag id={id} className={cn(variants[variant], className)}>
      {children}
    </Tag>
  );
}
