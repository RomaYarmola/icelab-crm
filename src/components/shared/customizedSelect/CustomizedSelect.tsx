import { SelectHTMLAttributes, useId } from "react";
import { cn } from "@/utils/cn";
import { getFieldClassName } from "../customizedInput/fieldStyles";
import ChevronIcon from "../icons/ChevronIcon";

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomizedSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "children"
> {
  name: string;
  label: string;
  options: SelectOption[];
  /** Текст помилки під полем (українською). Якщо є, поле підсвічується. */
  error?: string;
  /** Підказка під полем, поки помилки немає. */
  hint?: string;
  /** Сховати підпис візуально (він лишається для екранних читалок). */
  isLabelHidden?: boolean;
  labelClassName?: string;
}

/**
 * Список вибору (нативний select) з підписом, підказкою і помилкою. Вигляд такий самий, як у
 * `CustomizedInput` (спільний `getFieldClassName`). Нативний список зручний на телефоні: відкривається
 * системним вибирачем.
 */
export default function CustomizedSelect({
  name,
  label,
  options,
  error,
  hint,
  isLabelHidden = false,
  labelClassName = "",
  ...rest
}: CustomizedSelectProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div className={cn("flex w-full flex-col gap-1.5", labelClassName)}>
      <label
        htmlFor={id}
        className={cn("text-body font-semibold text-navy", isLabelHidden && "sr-only")}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          className={getFieldClassName({
            hasError: Boolean(error),
            className: "appearance-none pr-12",
          })}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-grey-text" />
      </div>
      {error ? (
        <p id={messageId} role="alert" className="text-body text-red-error">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-body text-grey-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
