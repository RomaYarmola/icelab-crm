interface UsersIconProps {
  className?: string;
}

/** Користувачі системи: дві фігури, одна з щитом (керування доступом). */
export default function UsersIcon({ className }: UsersIconProps) {
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
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 19.5c0-3.3 2.7-5.5 6-5.5 1.3 0 2.5.3 3.4.9" />
      <path d="M18 13.2l3 1.2v2.4c0 1.9-1.2 3.3-3 4-1.8-.7-3-2.1-3-4v-2.4z" />
    </svg>
  );
}
