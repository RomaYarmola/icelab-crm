"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(app)/more/users/actions";
import { MIN_PASSWORD_LENGTH } from "@/constants/constants";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import GeneratePasswordField from "../shared/customizedInput/GeneratePasswordField";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";

/** Власник задає новий пароль користувачу (листів система не надсилає, тож пароль повідомляють самі). */
export default function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, INITIAL_FORM_STATE);

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={userId} />
      <Text variant="muted">
        Листів система не надсилає: новий пароль повідомте користувачу самі. Старий пароль перестане
        працювати.
      </Text>
      <GeneratePasswordField
        name="password"
        label="Новий пароль"
        hint={`Щонайменше ${MIN_PASSWORD_LENGTH} символів. Згенерований пароль скопіюйте й передайте користувачу.`}
        required
        confirmName="confirm"
      />
      <FormMessage state={state} />
      <MainButton type="submit" variant="outline" isLoading={isPending} loadingText="Зберігаємо…">
        Задати новий пароль
      </MainButton>
    </Form>
  );
}
