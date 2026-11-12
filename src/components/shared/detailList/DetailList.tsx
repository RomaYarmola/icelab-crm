import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import Text from "../texts/Text";

export interface DetailItem {
  label: string;
  /** Порожнє значення показуємо як «Не вказано». */
  value: ReactNode;
}

interface DetailListProps {
  items: DetailItem[];
  className?: string;
}

/** Перелік «назва: значення» для перегляду даних картки. Назва дрібніша й сіра, значення звичайне. */
export default function DetailList({ items, className }: DetailListProps) {
  return (
    <dl className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => {
        const isEmpty = item.value === null || item.value === undefined || item.value === "";
        return (
          <div key={item.label} className="flex flex-col gap-0.5">
            <dt>
              <Text as="span" variant="muted">
                {item.label}
              </Text>
            </dt>
            <dd className="text-body break-words whitespace-pre-line text-navy">
              {isEmpty ? <span className="text-grey-text">Не вказано</span> : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
