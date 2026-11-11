import { cn } from "@/utils/cn";

interface LoaderIconProps {
  className?: string;
}

/** Індикатор завантаження: колір береться з тексту батьківського елемента. */
export default function LoaderIcon({ className }: LoaderIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rotation size-6", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
