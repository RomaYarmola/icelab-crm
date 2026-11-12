"use client";

import { useState } from "react";
import { generatePassword } from "@/utils/generatePassword";
import MainButton from "../buttons/MainButton";
import CopyIcon from "../icons/CopyIcon";
import RefreshIcon from "../icons/RefreshIcon";
import TickIcon from "../icons/TickIcon";
import CustomizedInput from "./CustomizedInput";

interface GeneratePasswordFieldProps {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Друге поле «Повторіть пароль»: «Згенерувати» заповнює обидва однаковим паролем. */
  confirmName?: string;
  confirmLabel?: string;
}

/**
 * Поле пароля для власника з кнопками «Згенерувати» і «Скопіювати», щоб не вигадувати пароль самому.
 * «Згенерувати» вписує випадковий пароль (`generatePassword`) і показує його, щоб власник міг його
 * переписати чи скопіювати й передати користувачу. Після збереження пароль уже не видно, тому
 * копіювати треба до відправки. Поле лишається звичайним: пароль можна й ввести вручну.
 */
export default function GeneratePasswordField({
  name,
  label,
  hint,
  required = false,
  confirmName,
  confirmLabel = "Повторіть пароль",
}: GeneratePasswordFieldProps) {
  const [value, setValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  function generate() {
    const password = generatePassword();
    setValue(password);
    setConfirmValue(password);
    // Згенерований пароль показуємо одразу: власник має його побачити й передати.
    setIsVisible(true);
    setIsCopied(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Буфер обміну недоступний (дозвіл, не-HTTPS): пароль видно в полі, його можна виділити вручну.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <CustomizedInput
        name={name}
        type="password"
        label={label}
        autoComplete="new-password"
        hint={hint}
        required={required}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setIsCopied(false);
        }}
        isPasswordVisible={isVisible}
        onPasswordVisibleChange={setIsVisible}
      />
      {confirmName ? (
        <CustomizedInput
          name={confirmName}
          type="password"
          label={confirmLabel}
          autoComplete="new-password"
          required={required}
          value={confirmValue}
          onChange={(event) => setConfirmValue(event.target.value)}
          isPasswordVisible={isVisible}
          onPasswordVisibleChange={setIsVisible}
        />
      ) : null}
      <div className="flex gap-3">
        <MainButton
          variant="outline"
          size="sm"
          fullWidth={false}
          className="flex-1"
          icon={<RefreshIcon className="size-5" />}
          onClick={generate}
        >
          Згенерувати
        </MainButton>
        {value ? (
          <MainButton
            variant="outline"
            size="sm"
            fullWidth={false}
            className="flex-1"
            icon={isCopied ? <TickIcon className="size-5" /> : <CopyIcon className="size-5" />}
            onClick={copy}
          >
            {isCopied ? "Скопійовано" : "Скопіювати"}
          </MainButton>
        ) : null}
      </div>
    </div>
  );
}
