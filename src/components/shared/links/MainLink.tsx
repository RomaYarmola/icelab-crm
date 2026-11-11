import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface MainLinkProps {
  href: string;
  children: ReactNode;
  isExternal?: boolean;
  className?: string;
}

/** Посилання в тексті: акцентний колір, підкреслення при наведенні й фокусі. */
export default function MainLink({ href, children, isExternal = false, className }: MainLinkProps) {
  const classes = cn(
    "text-body font-semibold text-blue underline-offset-4 transition focus-visible:underline lg:hover:underline",
    className,
  );

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
