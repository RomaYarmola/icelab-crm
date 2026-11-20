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
 * «Назад» працює, а сторінку можна надіслати. Назви не обрізаємо: коли вкладки не вміщаються
 * (вузький екран), рядок гортається вліво-вправо, а коли місця вдосталь, вкладки ділять ширину
 * порівну. Активну позначає колір і нижня смужка, розмір шрифту не міняється.
 */
export default function TabLinks({ items, activeId, label, className }: TabLinksProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "overflow-x-auto border-b border-grey-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <ul className="flex w-full min-w-max">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                replace
                scroll={false}
                className={cn(
                  "-mb-px flex min-h-11 items-center justify-center whitespace-nowrap border-b-2 px-3 text-center text-body font-semibold transition active:scale-[98%]",
                  isActive
                    ? "border-navy text-navy"
                    : "border-transparent text-grey-text lg:hover:text-navy",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
