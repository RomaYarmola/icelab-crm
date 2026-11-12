"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/(app)/more/actions";
import { MIN_PASSWORD_LENGTH } from "@/constants/constants";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";

/** Зміна власного пароля: новий пароль двічі. Після успіху поля очищаються. */
export default function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <CustomizedInput
        name="password"
        type="password"
        label="Новий пароль"
        autoComplete="new-password"
        hint={`Щонайменше ${MIN_PASSWORD_LENGTH} символів.`}
        required
      />
      <CustomizedInput
        name="confirm"
        type="password"
        label="Повторіть пароль"
        autoComplete="new-password"
        required
      />
      <FormMessage state={state} />
      <MainButton type="submit" isLoading={isPending} loadingText="Зберігаємо…">
        Змінити пароль
      </MainButton>
    </Form>
  );
}
