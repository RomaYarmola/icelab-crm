import { cn } from "@/utils/cn";
import LoaderIcon from "../icons/LoaderIcon";

interface LoaderProps {
  className?: string;
  /** Підпис для екранних читалок. */
  label?: string;
}

/** Індикатор завантаження по центру області. Використовується в loading.tsx. */
export default function Loader({ className = "", label = "Завантаження" }: LoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex min-h-[50dvh] w-full items-center justify-center text-blue", className)}
    >
      <LoaderIcon className="size-8" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
