import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import InfoIcon from "../icons/InfoIcon";
import TickIcon from "../icons/TickIcon";
import WarningIcon from "../icons/WarningIcon";

export type NotificationVariant = "info" | "success" | "warning" | "error";

interface NotificationProps {
  children: ReactNode;
  variant?: NotificationVariant;
  title?: string;
  /** Кнопка або посилання справа (наприклад, «Повторити»). */
  action?: ReactNode;
  className?: string;
}

const variants: Record<NotificationVariant, string> = {
  info: "bg-status-confirmed text-status-confirmed-text",
  success: "bg-status-packed text-status-packed-text",
  warning: "bg-status-in-production text-status-in-production-text",
  error: "bg-status-cancelled text-status-cancelled-text",
};

const icons: Record<NotificationVariant, typeof InfoIcon> = {
  info: InfoIcon,
  success: TickIcon,
  warning: WarningIcon,
  error: WarningIcon,
};

/**
 * Повідомлення в тексті сторінки (не спливає і не закриває екран). Помилки й попередження
 * озвучуються як alert, решта як status.
 */
export default function Notification({
  children,
  variant = "info",
  title,
  action,
  className = "",
}: NotificationProps) {
  const Icon = icons[variant];
  const role = variant === "error" || variant === "warning" ? "alert" : "status";

  return (
    <div
      role={role}
      className={cn(
        "flex w-full items-start gap-3 rounded-field px-4 py-3 text-body",
        variants[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 size-6 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-bold">{title}</p> : null}
        <p>{children}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
