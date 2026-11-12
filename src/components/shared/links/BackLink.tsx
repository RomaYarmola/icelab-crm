import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/utils/cn";
import ChevronIcon from "../icons/ChevronIcon";

interface BackLinkProps {
  href: string;
  /** Куди повертає: назва попереднього екрана («Профіль», «Користувачі»). */
  children: ReactNode;
  className?: string;
}

/**
 * Посилання «назад» зверху екрана: стрілка-значок і назва попереднього екрана. Висота 44 px, при
 * наведенні (від lg) світлий фон. Лівий відступ від'ємний, щоб кінчик стрілки стояв рівно з лівим краєм
 * вмісту екрана (у значка є власні поля).
 */
export default function BackLink({ href, children, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-3 inline-flex min-h-11 w-fit items-center gap-1 rounded-field pr-4 pl-1 text-body font-semibold text-grey-text transition active:scale-[98%] lg:hover:bg-grey-light lg:hover:text-navy",
        className,
      )}
    >
      <ChevronIcon className="size-6 shrink-0 rotate-90" />
      <span>{children}</span>
    </Link>
  );
}
