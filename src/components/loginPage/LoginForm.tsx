"use client";

import { useActionState } from "react";
import { signInAction, signInWithGoogleAction, type SignInFormState } from "@/app/login/actions";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";

interface LoginFormProps {
  /** Повідомлення, з яким користувача повернуло на вхід (наприклад, відмова після Google). */
  initialMessage?: string;
}

const initialState: SignInFormState = {};

/** Форма входу: e-mail і пароль, нижче вхід через Google. Поведінка з блока B2 без змін. */
export default function LoginForm({ initialMessage }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);
  const message = state.message ?? initialMessage;

  return (
    <div className="flex w-full flex-col gap-6">
      <Form action={formAction}>
        <CustomizedInput
          name="email"
          type="email"
          label="E-mail"
          autoComplete="username"
          defaultValue={state.email}
          required
        />
        <CustomizedInput
          name="password"
          type="password"
          label="Пароль"
          autoComplete="current-password"
          required
        />
        {message ? <Notification variant="error">{message}</Notification> : null}
        <MainButton type="submit" isLoading={isPending} loadingText="Входимо…">
          Увійти
        </MainButton>
      </Form>

      <Text variant="muted" className="text-center">
        або
      </Text>

      <Form action={signInWithGoogleAction}>
        <MainButton type="submit" variant="outline">
          Увійти через Google
        </MainButton>
      </Form>
    </div>
  );
}
