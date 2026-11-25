interface AnalyticsIconProps {
  className?: string;
}

/** Аналітика: стовпчики графіка. */
export default function AnalyticsIcon({ className }: AnalyticsIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 20h16" />
      <path d="M7 17v-5" />
      <path d="M12 17V5" />
      <path d="M17 17v-8" />
    </svg>
  );
}
