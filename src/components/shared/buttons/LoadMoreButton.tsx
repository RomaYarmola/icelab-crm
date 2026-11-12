import MainButton from "./MainButton";

interface LoadMoreButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  children?: string;
}

/** Кнопка «Показати ще» під довгим списком: довантажує наступну частину. */
export default function LoadMoreButton({
  onClick,
  isLoading = false,
  children = "Показати ще",
}: LoadMoreButtonProps) {
  return (
    <MainButton
      variant="outline"
      onClick={onClick}
      isLoading={isLoading}
      loadingText="Завантажуємо…"
      className="lg:max-w-xs lg:self-center"
    >
      {children}
    </MainButton>
  );
}
