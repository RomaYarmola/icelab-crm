import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { locations, profiles, telegramLinkCodes } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { ValidationError } from "../errors";
import { type AppUser, requirePermission } from "../guards";
import {
  getMe,
  getTelegramToken,
  getTelegramWebhookSecret,
  getWebhookInfo,
  setWebhook,
  TelegramError,
} from "./client";
import { getConfirmerIds } from "../intake/confirmers";
import { getTelegramSettings, setTelegramSettings, type TelegramSettings } from "./settings";

/**
 * Налаштування приймання заявок для власника (B11, ТЗ 6.12): чи є токен бота й секрет, перевірка
 * з'єднання, підключення webhook, визначення топіків групи, прив'язка користувачів до Telegram.
 * Токен і секрет на екран не потрапляють: лише «є» чи «немає».
 */

const assertOwner = (actor: AppUser) => requirePermission(actor, "migration_settings", "write");

/** Скільки живе код прив'язки (D136). */
export const LINK_CODE_HOURS = 24;
/** Скільки чекаємо повідомлення в топіку, щоб його запам'ятати. */
export const CAPTURE_MINUTES = 10;

/** Кому власник підключає Telegram (бот): заявки, водії, нагадування. */
export const LINKABLE_ROLES = [
  "owner",
  "manager",
  "location_lead",
  "production",
  "driver",
  "accountant",
] as const;
export type LinkableRole = (typeof LINKABLE_ROLES)[number];

export type IntakeUser = {
  id: string;
  fullName: string;
  role: LinkableRole;
  locationName: string | null;
  isLinked: boolean;
  /** Може підтверджувати чернетки (D151). */
  isConfirmer: boolean;
};

export type IntakeStatus = {
  hasToken: boolean;
  hasWebhookSecret: boolean;
  settings: TelegramSettings;
  users: IntakeUser[];
  /** Список підтверджувачів порожній: підтверджує будь-хто з офісу. */
  anyoneConfirms: boolean;
};

export async function getIntakeStatus(db: AnyPgDatabase, actor: AppUser): Promise<IntakeStatus> {
  assertOwner(actor);
  const [settings, confirmerIds, rows] = await Promise.all([
    getTelegramSettings(db),
    getConfirmerIds(db),
    db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        telegramUserId: profiles.telegramUserId,
        locationName: locations.name,
      })
      .from(profiles)
      .leftJoin(locations, eq(locations.id, profiles.locationId))
      .where(and(eq(profiles.isActive, true), inArray(profiles.role, [...LINKABLE_ROLES])))
      .orderBy(asc(profiles.role), asc(profiles.fullName)),
  ]);
  return {
    hasToken: getTelegramToken() !== null,
    hasWebhookSecret: getTelegramWebhookSecret() !== null,
    settings,
    users: rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      role: row.role as LinkableRole,
      locationName: row.locationName,
      isLinked: row.telegramUserId !== null,
      isConfirmer: confirmerIds.includes(row.id),
    })),
    anyoneConfirms: confirmerIds.length === 0,
  };
}

type Options = Parameters<typeof getMe>[1];

/** «Перевірити з'єднання»: бот відповідає, і до якої адреси підключено webhook. */
export async function checkTelegramConnection(
  db: AnyPgDatabase,
  actor: AppUser,
  expectedUrl: string | null,
  options?: Options,
): Promise<{ ok: boolean; message: string }> {
  assertOwner(actor);
  try {
    const bot = await getMe(db, options);
    const info = await getWebhookInfo(db, options);
    if (bot.username) await setTelegramSettings(db, actor.id, { botUsername: bot.username });
    const hook = info.url?.trim();
    let message = `Бот «@${bot.username ?? bot.id}» відповідає. `;
    if (!hook) message += "Webhook ще не підключено.";
    else if (expectedUrl && hook !== expectedUrl)
      message += `Webhook підключено до іншої адреси: ${hook}.`;
    else message += "Webhook підключено до цього застосунку.";
    if (info.last_error_message)
      message += ` Остання помилка Telegram: ${info.last_error_message}.`;
    return { ok: true, message };
  } catch (error) {
    if (error instanceof TelegramError) return { ok: false, message: error.message };
    throw error;
  }
}

/** «Підключити бота до цієї адреси»: `setWebhook` з секретом. Адреса має бути https. */
export async function connectTelegramWebhook(
  db: AnyPgDatabase,
  actor: AppUser,
  baseUrl: string,
  options?: Options,
): Promise<string> {
  assertOwner(actor);
  const secret = getTelegramWebhookSecret();
  if (!secret) {
    throw new ValidationError(
      "Секрет webhook не налаштовано. Додайте його в змінні середовища сервера.",
    );
  }
  if (!/^https:\/\/[^/\s]+$/.test(baseUrl) || /localhost|127\.0\.0\.1/.test(baseUrl)) {
    throw new ValidationError(
      "Telegram приймає лише https-адреси. Підключайте бота на розгорнутому застосунку, а не на локальному.",
    );
  }
  const url = `${baseUrl}/api/telegram/webhook`;
  try {
    await setWebhook(db, { url, secretToken: secret }, options);
  } catch (error) {
    if (error instanceof TelegramError) throw new ValidationError(error.message);
    throw error;
  }
  return url;
}

/** Починає «визначення топіка»: наступне повідомлення власника в ньому запам'ятає його номер. */
export async function startTopicCapture(
  db: AnyPgDatabase,
  actor: AppUser,
  target: "kyiv" | "lviv",
  now: Date = new Date(),
): Promise<void> {
  assertOwner(actor);
  if (!getTelegramToken()) throw new ValidationError("Спершу налаштуйте токен бота.");
  const [linked] = await db
    .select({ telegramUserId: profiles.telegramUserId })
    .from(profiles)
    .where(and(eq(profiles.id, actor.id), eq(profiles.isActive, true)));
  if (!linked) throw new ValidationError("Користувача не знайдено.");
  if (linked.telegramUserId == null) {
    throw new ValidationError(
      "Спершу підключіть свій Telegram: створіть код біля свого імені нижче й надішліть його боту.",
    );
  }
  await setTelegramSettings(db, actor.id, {
    capture: {
      target,
      expiresAt: new Date(now.getTime() + CAPTURE_MINUTES * 60_000).toISOString(),
    },
  });
}

export async function cancelTopicCapture(db: AnyPgDatabase, actor: AppUser): Promise<void> {
  assertOwner(actor);
  await setTelegramSettings(db, actor.id, { capture: null });
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Код з 8 символів без схожих літер і цифр (0/O, 1/I). */
export function generateLinkCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** Створює код прив'язки Telegram для користувача (D136); попередні невикористані коди стають недійсними. */
export async function createLinkCode(
  db: AnyPgDatabase,
  actor: AppUser,
  profileId: string,
  now: Date = new Date(),
): Promise<{ code: string; link: string | null; expiresAt: Date }> {
  assertOwner(actor);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.isActive, true)));
  if (!profile || !(LINKABLE_ROLES as readonly string[]).includes(profile.role)) {
    throw new ValidationError("Користувача не знайдено або він вимкнений.");
  }
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_HOURS * 3_600_000);
  await withActor(db, actor.id, async (tx) => {
    await tx
      .delete(telegramLinkCodes)
      .where(and(eq(telegramLinkCodes.profileId, profileId), isNull(telegramLinkCodes.usedAt)));
    await tx.insert(telegramLinkCodes).values({ code, profileId, expiresAt });
  });
  const { botUsername } = await getTelegramSettings(db);
  return {
    code,
    link: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
    expiresAt,
  };
}

/** Відв'язує Telegram від користувача. */
export async function unlinkTelegram(
  db: AnyPgDatabase,
  actor: AppUser,
  profileId: string,
): Promise<void> {
  assertOwner(actor);
  await withActor(db, actor.id, (tx) =>
    tx.update(profiles).set({ telegramUserId: null }).where(eq(profiles.id, profileId)),
  );
}
