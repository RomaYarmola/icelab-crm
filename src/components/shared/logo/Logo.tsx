import Image from "next/image";
import { cn } from "@/utils/cn";

type LogoVariant = "full" | "mark";

interface LogoProps {
  /** `full`: кристал і напис ICELAB, `mark`: лише кристал. */
  variant?: LogoVariant;
  className?: string;
  priority?: boolean;
}

const files: Record<LogoVariant, { src: string; width: number; height: number }> = {
  full: { src: "/images/logo/logo.svg", width: 62, height: 55 },
  mark: { src: "/images/logo/mark.svg", width: 48, height: 48 },
};

/** Логотип IceLab (файли з сайту компанії, public/images/logo). */
export default function Logo({ variant = "full", className = "", priority = false }: LogoProps) {
  const { src, width, height } = files[variant];

  return (
    <Image
      src={src}
      alt="IceLab"
      width={width}
      height={height}
      priority={priority}
      // SVG віддаємо як є: оптимізатор зображень для векторних файлів не потрібен.
      unoptimized
      className={cn("h-auto", variant === "full" ? "w-28" : "w-9", className)}
    />
  );
}
