"use client";

import { useActionState } from "react";
import { setUserActiveAction } from "@/app/(app)/more/users/actions";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";

interface UserStatusFormProps {
  userId: string;
  isActive: boolean;
  /** Це обліковий запис самого власника: вимкнути себе не можна. */
  isSelf: boolean;
}

/** Вимкнути або увімкнути користувача. Видаляти не можна: на нього посилається історія. */
export default function UserStatusForm({ userId, isActive, isSelf }: UserStatusFormProps) {
  const [state, formAction, isPending] = useActionState(setUserActiveAction, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={userId} />
      <input type="hidden" name="active" value={isActive ? "0" : "1"} />
      <Text variant="muted">
        {isActive
          ? "Вимкнений користувач не може увійти. Його історія в системі зберігається, а доступ можна повернути."
          : "Користувача вимкнено: він не може увійти. Увімкніть його, щоб повернути доступ."}
      </Text>
      {isSelf ? <Text variant="muted">Власний обліковий запис вимкнути не можна.</Text> : null}
      <FormMessage state={state} />
      {isSelf && isActive ? null : (
        <MainButton
          type="submit"
          variant={isActive ? "outline" : "fill"}
          isLoading={isPending}
          loadingText="Зберігаємо…"
        >
          {isActive ? "Вимкнути користувача" : "Увімкнути користувача"}
        </MainButton>
      )}
    </Form>
  );
}
