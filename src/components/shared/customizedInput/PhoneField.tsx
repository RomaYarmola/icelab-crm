"use client";

import { InputHTMLAttributes } from "react";
import { formatPhone, normalizePhone } from "@/utils/phone";
import CustomizedInput from "./CustomizedInput";

interface PhoneFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type" | "inputMode"
> {
  name: string;
  label: string;
  error?: string;
  hint?: string;
}

/**
 * Поле телефону: на телефоні відкриває цифрову клавіатуру (`type="tel"`), вводити можна як завгодно
 * (`050 123 45 67`, `(050) 123-45-67`). Коли поле втрачає фокус і номер розпізнано, він
 * переписується в охайному вигляді «+38 050 123 45 67». На сервері номер приводиться до +380…
 */
export default function PhoneField({ onBlur, ...rest }: PhoneFieldProps) {
  return (
    <CustomizedInput
      type="tel"
      inputMode="tel"
      autoComplete="off"
      placeholder="050 123 45 67"
      {...rest}
      onBlur={(event) => {
        const phone = normalizePhone(event.currentTarget.value);
        if (phone) event.currentTarget.value = formatPhone(phone);
        onBlur?.(event);
      }}
    />
  );
}
