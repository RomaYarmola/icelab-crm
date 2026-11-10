import { and, desc, eq, gt, lt } from "drizzle-orm";
import { loginFailures } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";

/**
 * Обмеження спроб входу за паролем (рішення D20).
 *
 * Supabase рахує ліміти за адресою, з якої прийшов запит. Вхід іде через наш сервер, тож для
 * Supabase всі користувачі це одна адреса сервера, і його ліміти не відрізняють зловмисника від
 * решти команди. Тому невдалі спроби рахуємо самі, у таблиці `login_failures`:
 *   - за e-mail: захищає конкретний акаунт від підбору пароля, звідки б не били;
 *   - за адресою клієнта: не дає перебирати багато різних e-mail з одного місця.
 * Вікно ковзне: заборона діє, доки найстаріша з останніх невдалих спроб не вийде за межі вікна.
 */

export const LOGIN_LIMITS = {
  /** Довжина вікна, за яке рахуємо невдалі спроби. */
  windowMs: 15 * 60 * 1000,
  /** Скільки невдалих спроб для одного e-mail за вікно, після чого вхід блокується. */
  maxFailuresPerEmail: 5,
  /** Скільки невдалих спроб з однієї адреси клієнта (з будь-яких e-mail) за вікно. */
  maxFailuresPerIp: 20,
  /** Старіші записи видаляємо при кожному записі. */
  retentionMs: 24 * 60 * 60 * 1000,
} as const;

export type LoginKey = {
  /** Нормалізований e-mail (нижній регістр). */
  email: string;
  /** Адреса клієнта або `null`, якщо її не визначено (тоді перевірка за адресою пропускається). */
  ip: string | null;
};

export type LoginCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Чи можна зараз пробувати увійти. Якщо ні, скільки секунд чекати до наступної спроби.
 * Якщо діють обидва обмеження, повертається довший час очікування.
 */
export async function checkLoginAllowed(
  db: AnyPgDatabase,
  key: LoginKey,
  now: Date = new Date(),
): Promise<LoginCheck> {
  const windowStart = new Date(now.getTime() - LOGIN_LIMITS.windowMs);

  const waits: number[] = [];
  const byEmail = await db
    .select({ createdAt: loginFailures.createdAt })
    .from(loginFailures)
    .where(and(eq(loginFailures.email, key.email), gt(loginFailures.createdAt, windowStart)))
    .orderBy(desc(loginFailures.createdAt))
    .limit(LOGIN_LIMITS.maxFailuresPerEmail);
  if (byEmail.length >= LOGIN_LIMITS.maxFailuresPerEmail) {
    waits.push(unlockAt(byEmail[byEmail.length - 1]!.createdAt) - now.getTime());
  }

  if (key.ip) {
    const byIp = await db
      .select({ createdAt: loginFailures.createdAt })
      .from(loginFailures)
      .where(and(eq(loginFailures.ip, key.ip), gt(loginFailures.createdAt, windowStart)))
      .orderBy(desc(loginFailures.createdAt))
      .limit(LOGIN_LIMITS.maxFailuresPerIp);
    if (byIp.length >= LOGIN_LIMITS.maxFailuresPerIp) {
      waits.push(unlockAt(byIp[byIp.length - 1]!.createdAt) - now.getTime());
    }
  }

  if (waits.length === 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) };
}

/** Записує невдалу спробу (невірний пароль). Заодно прибирає записи старші за добу. */
export async function recordLoginFailure(
  db: AnyPgDatabase,
  key: LoginKey,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(loginFailures).values({ email: key.email, ip: key.ip, createdAt: now });
  await purgeOld(db, now);
}

/**
 * Успішний вхід: невдалі спроби цього e-mail більше не рахуються. Спроби з адреси клієнта
 * лишаються, щоб успішний вхід у власний акаунт не обнулював перебір чужих.
 */
export async function recordLoginSuccess(
  db: AnyPgDatabase,
  key: LoginKey,
  now: Date = new Date(),
): Promise<void> {
  await db.delete(loginFailures).where(eq(loginFailures.email, key.email));
  await purgeOld(db, now);
}

/** Текст «спробуйте через N хв» для користувача (мінімум 1 хвилина). */
export function minutesToWait(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

async function purgeOld(db: AnyPgDatabase, now: Date): Promise<void> {
  await db
    .delete(loginFailures)
    .where(lt(loginFailures.createdAt, new Date(now.getTime() - LOGIN_LIMITS.retentionMs)));
}

const unlockAt = (oldestFailure: Date) => oldestFailure.getTime() + LOGIN_LIMITS.windowMs;
