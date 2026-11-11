interface ChevronIconProps {
  className?: string;
}

/** Стрілка вниз. Для інших напрямків повертаємо класом (`rotate-90`, `-rotate-90`, `rotate-180`). */
export default function ChevronIcon({ className }: ChevronIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
