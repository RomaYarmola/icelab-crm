import { FormHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "className"> {
  children: ReactNode;
  className?: string;
}

/** Форма з однаковими відступами між полями. Поля: CustomizedInput, кнопки: MainButton. */
export default function Form({ children, className = "", ...rest }: FormProps) {
  return (
    <form className={cn("flex w-full flex-col gap-4", className)} {...rest}>
      {children}
    </form>
  );
}
