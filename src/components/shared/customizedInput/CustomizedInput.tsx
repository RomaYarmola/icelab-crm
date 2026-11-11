"use client";

import { InputHTMLAttributes, TextareaHTMLAttributes, useId, useState } from "react";
import { cn } from "@/utils/cn";
import IconButton from "../buttons/IconButton";
import EyeIcon from "../icons/EyeIcon";
import EyeOffIcon from "../icons/EyeOffIcon";
import IconSwitch from "../icons/IconSwitch";

interface CustomizedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  name: string;
  label: string;
  /** Текст помилки під полем (українською). Якщо є, поле підсвічується. */
  error?: string;
  /** Підказка під полем, поки помилки немає. */
  hint?: string;
  /** Сховати підпис візуально (він лишається для екранних читалок). */
  isLabelHidden?: boolean;
  as?: "input" | "textarea";
  labelClassName?: string;
  fieldClassName?: string;
}

/**
 * Поле вводу з підписом, підказкою і помилкою під полем. Висота від 44 px, шрифт від 16 px.
 * Використовується в усіх формах: з нього складаються логін, користувачі, клієнти, замовлення.
 * Для `type="password"` усередині поля справа з'являється кнопка «показати / сховати пароль».
 *
 * Фокус: рамка поля стає акцентною і з'являється м'яка тінь (`shadow-focus`), товщина рамки не
 * змінюється. Усі значення беруться з токенів у globals.css.
 */
export default function CustomizedInput({
  name,
  label,
  error,
  hint,
  isLabelHidden = false,
  as = "input",
  type = "text",
  labelClassName = "",
  fieldClassName = "",
  ...rest
}: CustomizedInputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPassword = as === "input" && type === "password";

  const fieldClasses = cn(
    "w-full rounded-field border bg-white px-4 text-body text-navy placeholder:text-grey-text transition disabled:opacity-60",
    error
      ? "border-red-error focus:shadow-focus-error"
      : "border-grey-field focus:border-blue-focus focus:shadow-focus lg:hover:not-focus:border-navy",
    as === "textarea" ? "min-h-32 resize-y py-3" : "min-h-12.5",
    isPassword && "pr-12",
    fieldClassName,
  );

  const commonProps = {
    id,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": hasMessage ? messageId : undefined,
    className: fieldClasses,
  };

  return (
    <div className={cn("flex w-full flex-col gap-1.5", labelClassName)}>
      <label
        htmlFor={id}
        className={cn("text-body font-semibold text-navy", isLabelHidden && "sr-only")}
      >
        {label}
      </label>
      {as === "textarea" ? (
        <textarea {...commonProps} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <div className="relative">
          <input
            {...commonProps}
            type={isPassword && isPasswordVisible ? "text" : type}
            {...rest}
          />
          {isPassword ? (
            <IconButton
              label={isPasswordVisible ? "Сховати пароль" : "Показати пароль"}
              aria-pressed={isPasswordVisible}
              disabled={rest.disabled}
              // Кнопка не забирає фокус у поля, тож можна натиснути її і одразу продовжити вводити.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              className="absolute top-1/2 right-1 -translate-y-1/2 text-grey-text lg:hover:text-navy"
            >
              <IconSwitch
                isOn={isPasswordVisible}
                on={<EyeOffIcon className="size-6" />}
                off={<EyeIcon className="size-6" />}
              />
            </IconButton>
          ) : null}
        </div>
      )}
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
