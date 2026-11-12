import type { FormState } from "@/utils/formState";
import Notification from "../notification/Notification";

interface FormMessageProps {
  state: FormState;
  className?: string;
}

/** Повідомлення про результат відправки форми: помилка (червоне) або успіх (зелене). Порожнє до відправки. */
export default function FormMessage({ state, className }: FormMessageProps) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Notification variant={state.status === "success" ? "success" : "error"} className={className}>
      {state.message}
    </Notification>
  );
}
