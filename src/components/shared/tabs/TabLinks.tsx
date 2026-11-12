import Link from "next/link";
import { cn } from "@/utils/cn";

export interface TabLinkItem {
  id: string;
  label: string;
  href: string;
}

interface TabLinksProps {
  items: TabLinkItem[];
  activeId: string;
  /** Назва групи вкладок для екранних читалок. */
  label: string;
  className?: string;
}

/**
 * Вкладки-посилання: кожна вкладка має власну адресу (`?tab=`), тож стан зберігається в адресі,
 * «Назад» працює, а сторінку можна надіслати. Вкладки однакової ширини в один рядок без прокрутки
 * (на 360 px вміщаються чотири). Активну позначає колір і нижня смужка, розмір шрифту не міняється.
 */
export default function TabLinks({ items, activeId, label, className }: TabLinksProps) {
  return (
    <nav aria-label={label} className={cn("border-b border-grey-border", className)}>
      <ul className="flex">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                replace
                scroll={false}
                className={cn(
                  "-mb-px flex min-h-11 items-center justify-center border-b-2 px-1 text-center text-body font-semibold transition active:scale-[98%]",
                  isActive
                    ? "border-navy text-navy"
                    : "border-transparent text-grey-text lg:hover:text-navy",
                )}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
