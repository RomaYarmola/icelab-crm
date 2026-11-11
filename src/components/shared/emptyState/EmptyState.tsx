import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import SubTitle from "../titles/SubTitle";
import Text from "../texts/Text";

interface EmptyStateProps {
  /** Одна фраза: що тут буде або чому порожньо. */
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Одна дія (вимога ТЗ): кнопка або посилання. */
  action?: ReactNode;
  className?: string;
}

/** Порожній стан: коли списку ще немає. Одна фраза і одна дія. */
export default function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border border-dashed border-grey-field px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-grey-text [&>svg]:size-10">{icon}</div> : null}
      <SubTitle>{title}</SubTitle>
      {description ? <Text variant="muted">{description}</Text> : null}
      {action ? <div className="mt-2 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}
