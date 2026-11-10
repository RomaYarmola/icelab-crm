"use client";

import { useActionState } from "react";
import { type SignInFormState, signInAction, signInWithGoogleAction } from "./actions";

const initialState: SignInFormState = {};

/** Технічна форма входу без дизайну. Справжній екран входу робимо в B3. */
export function LoginForm({ initialMessage }: { initialMessage?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const message = state.message ?? initialMessage;

  return (
    <div className="flex w-full flex-col gap-4">
      <form action={signInWithGoogleAction}>
        <button
          type="submit"
          className="min-h-11 w-full rounded border border-neutral-900 px-4 text-base font-medium"
        >
          Увійти через Google
        </button>
      </form>

      <p className="text-center text-base text-neutral-600">або</p>

      <form action={formAction} className="flex w-full flex-col gap-4">
        <label className="flex flex-col gap-1 text-base">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="min-h-11 rounded border border-neutral-400 px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-base">
          Пароль
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="min-h-11 rounded border border-neutral-400 px-3 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded bg-neutral-900 px-4 text-base font-medium text-white disabled:opacity-60"
        >
          {pending ? "Входимо..." : "Увійти"}
        </button>
      </form>

      {message ? (
        <p role="alert" className="text-base text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
