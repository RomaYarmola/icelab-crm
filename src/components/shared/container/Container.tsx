import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ContainerProps {
  children?: ReactNode;
  className?: string;
}

/** Центрує вміст і обмежує ширину за тими самими брейкпоінтами, що в nbyg-front. */
export default function Container({ children, className = "" }: ContainerProps) {
  return (
    <div
      className={cn(
        "xs:max-w-full sm:max-w-[640px] md:max-w-3xl lg:max-w-5xl xl:max-w-7xl px-4 lg:px-15 mx-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
