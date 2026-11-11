interface ProductionIconProps {
  className?: string;
}

export default function ProductionIcon({ className }: ProductionIconProps) {
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
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5 4.2 16.5" />
      <path d="M9.5 4.6 12 6.6l2.5-2M9.5 19.4 12 17.4l2.5 2" />
    </svg>
  );
}
