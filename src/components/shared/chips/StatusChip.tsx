import { OrderStatus, ORDER_STATUS_LABELS } from "@/constants/constants";
import { cn } from "@/utils/cn";

interface StatusChipProps {
  status: OrderStatus;
  className?: string;
}

/** Класи записані повністю, щоб Tailwind їх знайшов. Кольори: --color-status-* у globals.css. */
const statusClasses: Record<OrderStatus, string> = {
  draft: "bg-status-draft text-status-draft-text",
  confirmed: "bg-status-confirmed text-status-confirmed-text",
  in_production: "bg-status-in-production text-status-in-production-text",
  packed: "bg-status-packed text-status-packed-text",
  shipped: "bg-status-shipped text-status-shipped-text",
  paid: "bg-status-paid text-status-paid-text",
  closed: "bg-status-closed text-status-closed-text",
  cancelled: "bg-status-cancelled text-status-cancelled-text line-through",
};

/** Статус замовлення. Завжди підписаний словом, не лише кольором (вимога ТЗ). */
export default function StatusChip({ status, className = "" }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-full px-3 text-body font-semibold whitespace-nowrap",
        statusClasses[status],
        className,
      )}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
