interface PriceIconProps {
  className?: string;
}

/** Прайс: цінник із отвором для шнурка. */
export default function PriceIcon({ className }: PriceIconProps) {
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
      <path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0l-7.6-7.6a1 1 0 0 1-.3-.7z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </svg>
  );
}
