import { z } from "zod";
import type { AnyPgDatabase } from "@/db/types";
import { AuthError, type AuthFailure, resolveAppUser } from "./current-user";
import type { AppUser } from "./guards";
import {
  checkLoginAllowed,
  minutesToWait,
  recordLoginFailure,
  recordLoginSuccess,
} from "./login-limiter";

/**
 * Вхід у систему: за e-mail і паролем та через Google (рішення D17).
 * Тексти повідомлень українською, їх можна показувати на екрані. Для невірного e-mail
 * і невірного пароля текст однаковий, щоб не підказувати, чи існує такий акаунт.
 *
 * Обидва способи закінчуються однаково: Supabase підтвердив особу, а далі ми перевіряємо, що
 * для неї є активний профіль з роллю, якій дозволено вхід у веб. Без профілю в нашій базі
 * в систему не пускаємо, навіть якщо Supabase створив акаунт.
 */

export const SIGN_IN_MESSAGES = {
  invalid: "Невірний e-mail або пароль.",
  badInput: "Введіть e-mail і пароль.",
  /** Supabase відповів, що запитів надто багато (ліміт на адресу сервера). */
  tooManyAttempts: "Забагато спроб входу. Спробуйте за кілька хвилин.",
  noProfile: "Для цього облікового запису не налаштовано доступ. Зверніться до власника.",
  inactive: "Обліковий запис вимкнено. Зверніться до власника.",
  webNotAllowed: "Для вашої ролі вхід у веб недоступний.",
  unexpected: "Не вдалося увійти. Спробуйте ще раз.",
  googleFailed:
    "Не вдалося увійти через Google. Якщо вас ще не додали в систему, зверніться до власника.",
} as const;

/** Наш ліміт невдалих спроб (`login-limiter.ts`): вхід тимчасово заблоковано. */
export function lockedOutMessage(minutes: number): string {
  return `Забагато невдалих спроб входу. Спробуйте через ${minutes} хв.`;
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

/** Причина, з якої сторінка входу показує повідомлення (передається в адресі `?reason=`). */
export type LoginReason = AuthFailure | "google_failed";

const FAILURE_MESSAGES: Record<AuthFailure, string> = {
  no_session: SIGN_IN_MESSAGES.unexpected,
  no_profile: SIGN_IN_MESSAGES.noProfile,
  inactive: SIGN_IN_MESSAGES.inactive,
  web_not_allowed: SIGN_IN_MESSAGES.webNotAllowed,
};

const REASON_MESSAGES: Record<LoginReason, string> = {
  ...FAILURE_MESSAGES,
  google_failed: SIGN_IN_MESSAGES.googleFailed,
};

/** Чи це причина відмови після перевірки профілю (так їх приймає `/auth/end-session`). */
export function isAuthFailure(value: unknown): value is AuthFailure {
  return typeof value === "string" && Object.hasOwn(FAILURE_MESSAGES, value);
}

/** Чи це відома причина для сторінки входу (параметр `reason` в адресі може підробити будь-хто). */
export function isLoginReason(value: unknown): value is LoginReason {
  return typeof value === "string" && Object.hasOwn(REASON_MESSAGES, value);
}

/** Повідомлення для сторінки входу за причиною з адреси. Невідома причина дає `undefined`. */
export function messageForReason(reason: unknown): string | undefined {
  return isLoginReason(reason) ? REASON_MESSAGES[reason] : undefined;
}

/** Те, що потрібно від Supabase Auth для виходу (реальний клієнт має цей метод). */
type SessionEnder = { signOut(): Promise<unknown> };

type Admission = { ok: true; user: AppUser } | { ok: false; reason: AuthFailure | "unexpected" };

/**
 * Supabase підтвердив особу: перевіряємо, що її можна пустити в систему. Якщо ні, скасовуємо
 * щойно створену сесію, щоб користувач не лишався «напівувійшовшим».
 */
async function admit(
  auth: SessionEnder,
  db: AnyPgDatabase,
  authUser: { id: string; email?: string },
): Promise<Admission> {
  try {
    const user = await resolveAppUser(db, { sub: authUser.id, email: authUser.email });
    return { ok: true, user };
  } catch (failure) {
    await auth.signOut();
    if (failure instanceof AuthError) return { ok: false, reason: failure.reason };
    console.error(
      "sign-in: не вдалося завантажити профіль:",
      failure instanceof Error ? failure.name : failure,
    );
    return { ok: false, reason: "unexpected" };
  }
}

// ---------------------------------------------------------------------------------------------
// E-mail і пароль
// ---------------------------------------------------------------------------------------------

/** Те, що потрібно від Supabase Auth для входу за паролем (реальний клієнт має ці методи). */
export type PasswordAuthApi = SessionEnder & {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: { id: string; email?: string } | null };
    error: { status?: number } | null;
  }>;
};

export type SignInResult = { ok: true; user: AppUser } | { ok: false; message: string };

/** Невірні облікові дані (4xx, окрім 429), а не збій мережі чи Supabase: лише такі спроби рахуємо. */
function isCredentialFailure(error: { status?: number }): boolean {
  return (
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

export type SignInContext = {
  /** Адреса клієнта (див. `lib/client-ip.ts`); `null`, якщо не визначено. */
  ip?: string | null;
  /** Поточний час (для тестів). */
  now?: Date;
};

/**
 * Вхід за e-mail і паролем. Перед зверненням до Supabase перевіряємо, що для цього e-mail
 * і цієї адреси клієнта не вичерпано ліміт невдалих спроб (рішення D20): так заблокований
 * акаунт не отримує підказки, чи підійшов пароль.
 */
export async function signInWithPassword(
  auth: PasswordAuthApi,
  db: AnyPgDatabase,
  input: unknown,
  context: SignInContext = {},
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: SIGN_IN_MESSAGES.badInput };

  const key = { email: parsed.data.email, ip: context.ip ?? null };
  const now = context.now ?? new Date();

  const limit = await checkLoginAllowed(db, key, now);
  if (!limit.allowed) {
    return { ok: false, message: lockedOutMessage(minutesToWait(limit.retryAfterSeconds)) };
  }

  const { data, error } = await auth.signInWithPassword(parsed.data);
  if (error) {
    if (isCredentialFailure(error)) await recordLoginFailure(db, key, now);
    return {
      ok: false,
      message: error.status === 429 ? SIGN_IN_MESSAGES.tooManyAttempts : SIGN_IN_MESSAGES.invalid,
    };
  }
  if (!data.user) return { ok: false, message: SIGN_IN_MESSAGES.invalid };

  // Пароль підійшов: невдалі спроби цього e-mail більше не рахуємо.
  await recordLoginSuccess(db, key, now);

  const admission = await admit(auth, db, data.user);
  if (admission.ok) return admission;
  return {
    ok: false,
    message:
      admission.reason === "unexpected"
        ? SIGN_IN_MESSAGES.unexpected
        : FAILURE_MESSAGES[admission.reason],
  };
}

// ---------------------------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------------------------

/** Те, що потрібно від Supabase Auth, щоб завершити вхід через Google (обмін коду на сесію). */
export type GoogleAuthApi = SessionEnder & {
  exchangeCodeForSession(code: string): Promise<{
    data: { user: { id: string; email?: string } | null };
    error: unknown;
  }>;
};

export type GoogleSignInResult = { ok: true; user: AppUser } | { ok: false; reason: LoginReason };

/**
 * Завершує вхід через Google: Google повернув користувача на `/auth/callback` з одноразовим
 * кодом. Обмінюємо код на сесію і перевіряємо профіль так само, як для пароля.
 *
 * Хто може увійти, вирішує не Google, а ми: потрібен акаунт, який створив власник (на цю саму
 * пошту), і активний профіль. Сторонній Google-акаунт у систему не потрапить.
 */
export async function completeGoogleSignIn(
  auth: GoogleAuthApi,
  db: AnyPgDatabase,
  params: { code: string | null; providerError: string | null },
): Promise<GoogleSignInResult> {
  // Google або Supabase повернули помилку (наприклад, користувач натиснув «Скасувати»,
  // або такого акаунта немає, а реєстрацію вимкнено), або коду немає взагалі.
  if (params.providerError || !params.code) return { ok: false, reason: "google_failed" };

  let exchanged: Awaited<ReturnType<GoogleAuthApi["exchangeCodeForSession"]>>;
  try {
    exchanged = await auth.exchangeCodeForSession(params.code);
  } catch {
    return { ok: false, reason: "google_failed" };
  }
  if (exchanged.error || !exchanged.data.user) return { ok: false, reason: "google_failed" };

  const admission = await admit(auth, db, exchanged.data.user);
  if (admission.ok) return admission;
  return {
    ok: false,
    reason: admission.reason === "unexpected" ? "google_failed" : admission.reason,
  };
}
