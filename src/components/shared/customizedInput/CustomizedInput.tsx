"use client";

import { InputHTMLAttributes, TextareaHTMLAttributes, useId, useState } from "react";
import { cn } from "@/utils/cn";
import IconButton from "../buttons/IconButton";
import EyeIcon from "../icons/EyeIcon";
import EyeOffIcon from "../icons/EyeOffIcon";
import IconSwitch from "../icons/IconSwitch";
import { getFieldClassName } from "./fieldStyles";

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
  /**
   * Лише для `type="password"`: показувати пароль текстом. Якщо передано, видимістю керує
   * батьківський компонент (разом з `onPasswordVisibleChange`), інакше поле запам'ятовує її саме.
   */
  isPasswordVisible?: boolean;
  onPasswordVisibleChange?: (isVisible: boolean) => void;
  labelClassName?: string;
  fieldClassName?: string;
}

/**
 * Поле вводу з підписом, підказкою і помилкою під полем. Висота від 44 px, шрифт від 16 px.
 * Використовується в усіх формах: з нього складаються логін, користувачі, клієнти, замовлення.
 * Для `type="password"` усередині поля справа з'являється кнопка «показати / сховати пароль».
 *
 * Вигляд поля (рамка, фокус, тінь) задає `getFieldClassName`, спільний зі списком `CustomizedSelect`.
 */
export default function CustomizedInput({
  name,
  label,
  error,
  hint,
  isLabelHidden = false,
  as = "input",
  type = "text",
  isPasswordVisible: isPasswordVisibleProp,
  onPasswordVisibleChange,
  labelClassName = "",
  fieldClassName = "",
  ...rest
}: CustomizedInputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);
  const [ownPasswordVisible, setOwnPasswordVisible] = useState(false);
  const isPasswordVisible = isPasswordVisibleProp ?? ownPasswordVisible;
  const isPassword = as === "input" && type === "password";

  const fieldClasses = getFieldClassName({
    hasError: Boolean(error),
    isMultiline: as === "textarea",
    className: cn(isPassword && "pr-12", fieldClassName),
  });

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
              onClick={() => {
                setOwnPasswordVisible(!isPasswordVisible);
                onPasswordVisibleChange?.(!isPasswordVisible);
              }}
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
