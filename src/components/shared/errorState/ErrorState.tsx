import { cn } from "@/utils/cn";
import MainButton from "../buttons/MainButton";
import WarningIcon from "../icons/WarningIcon";
import Text from "../texts/Text";
import SubTitle from "../titles/SubTitle";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Якщо передано, показується кнопка «Повторити» (вимога ТЗ для помилки сервера). */
  onRetry?: () => void;
  className?: string;
}

/** Помилка сервера: текст і кнопка «Повторити». Подробиці пишемо в журнал, не на екран. */
export default function ErrorState({
  title = "Щось пішло не так",
  description = "Не вдалося виконати дію. Спробуйте ще раз, а якщо помилка повторюється, зверніться до власника.",
  onRetry,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border border-grey-border bg-grey-light px-6 py-10 text-center",
        className,
      )}
    >
      <WarningIcon className="size-10 text-red-error" />
      <SubTitle>{title}</SubTitle>
      <Text variant="muted">{description}</Text>
      {onRetry ? (
        <div className="mt-2 w-full max-w-xs">
          <MainButton onClick={onRetry}>Повторити</MainButton>
        </div>
      ) : null}
    </div>
  );
}
