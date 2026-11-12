import { InputHTMLAttributes, useId } from "react";
import { cn } from "@/utils/cn";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  name: string;
  label: string;
  hint?: string;
  className?: string;
}

/**
 * Прапорець з підписом. Зона натискання від 44 px: клікабельний увесь рядок (підпис теж), а сам
 * квадрат 24 px. Колір галочки з токена `navy`, відправляється зі значенням «on».
 */
export default function Checkbox({ name, label, hint, className, ...rest }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-body text-navy">
        <input
          id={id}
          type="checkbox"
          name={name}
          aria-describedby={hint ? hintId : undefined}
          className="size-6 shrink-0 accent-navy"
          {...rest}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="text-body text-grey-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
