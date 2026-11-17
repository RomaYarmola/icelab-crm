interface ParcelIconProps {
  className?: string;
}

/** Посилка зі стрічкою: Нова Пошта (відправлення, накладні). */
export default function ParcelIcon({ className }: ParcelIconProps) {
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
      <path d="M3.5 8.2 12 4l8.5 4.2v7.6L12 20l-8.5-4.2z" />
      <path d="M3.5 8.2 12 12.4l8.5-4.2" />
      <path d="M12 12.4V20" />
      <path d="M7.7 6.1l8.5 4.2" />
    </svg>
  );
}
