import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { withActor } from "@/db/actor";
import { intakeMessages, locations, orders, profiles, settings } from "@/db/schema";
import type { AnyPgDatabase } from "@/db/types";
import { ValidationError } from "../errors";
import { createOrder, updateOrder } from "../orders";
import type { AppUser } from "../guards";
import {
  callClaude,
  ClaudeError,
  estimateCostUsd,
  type ClaudeRequest,
  type ClaudeResponse,
  type ClaudeUsage,
} from "./claude";
import { buildDraft, type DraftBuild } from "./draft";
import { buildClaudeRequest, kyivDay, loadClientLines, loadDictionaries } from "./prompt";
import { parseResultSchema, type ParseResult } from "./schema";

/**
 * Обробка одного повідомлення-заявки (B11, ТЗ 8.3, D138, D145): розбір Claude, чернетка замовлення,
 * запис результату, токенів і вартості. Повідомлення береться з блокуванням (`FOR UPDATE SKIP LOCKED`),
 * тож двоє одночасних викликів (відповідь webhook і запасний розклад) не створять двох чернеток.
 * Змінене повідомлення, у якого чернетка вже є, оновлює її, а не створює нову.
 */

/** Денний ліміт викликів Claude (ТЗ 8.3, допущення 500); змінюється налаштуванням `claude.daily_limit`. */
export const DEFAULT_DAILY_LIMIT = 500;
const LIMIT_KEY = "claude.daily_limit";

export type ProcessOutcome =
  | {
      status: "drafted";
      orderId: string;
      number: number | null;
      draft: DraftBuild;
      updated: boolean;
      /** Інші дні з того ж повідомлення: окремі чернетки (D159). */
      extraOrderIds: string[];
    }
  | { status: "limit"; orderId: string; number: number | null }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "noop"; reason: string };

export type ProcessDeps = {
  /** Підміна виклику Claude (тести й оцінка). */
  claude?: (request: ClaudeRequest) => Promise<ClaudeResponse>;
  now?: Date;
};

async function dailyLimit(db: AnyPgDatabase): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, LIMIT_KEY));
  return typeof row?.value === "number" && row.value >= 0 ? row.value : DEFAULT_DAILY_LIMIT;
}

/** Скільки викликів Claude вже було сьогодні (за київським днем). */
async function callsToday(db: AnyPgDatabase, now: Date): Promise<number> {
  const day = kyivDay(now);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(intakeMessages)
    .where(
      and(
        isNotNull(intakeMessages.tokensIn),
        gte(sql`(${intakeMessages.updatedAt} at time zone 'Europe/Kyiv')::date`, sql`${day}::date`),
      ),
    );
  return row?.n ?? 0;
}

/** Автор чернетки: менеджер чи власник, що написав повідомлення (за прив'язаним Telegram). */
async function authorOf(db: AnyPgDatabase, telegramUserId: number | null): Promise<AppUser | null> {
  if (telegramUserId === null) return null;
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.telegramUserId, telegramUserId), eq(profiles.isActive, true)));
  if (!row || (row.role !== "owner" && row.role !== "manager")) return null;
  return {
    id: row.id,
    email: null,
    fullName: row.fullName,
    role: row.role,
    locationId: row.locationId,
    locationName: null,
  };
}

function addUsage(a: ClaudeUsage, b: ClaudeUsage): ClaudeUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

const EMPTY_PARSE: ParseResult = {
  client: { code: null, name_guess: null, confidence: 0 },
  order_date: null,
  kg_sold: null,
  ice_type: null,
  box: { type_code: null, count: null, ownership: null },
  delivery: {
    method: null,
    city: null,
    np_warehouse_number: null,
    address: null,
    time_window: null,
    recipient_name: null,
    recipient_phone: null,
  },
  payment_hint: null,
  comment: null,
  unclear: [],
};

/**
 * Розбирає повідомлення зі статусом «нове» і створює чернетку замовлення (чи оновлює наявну).
 * Помилка Claude не губить заявку: повідомлення стає «не вдалося», і менеджер створить замовлення
 * в CRM сам. Після денного ліміту чернетка створюється порожньою з текстом заявки в коментарі.
 */
export async function processIntakeMessage(
  db: AnyPgDatabase,
  messageId: string,
  deps: ProcessDeps = {},
): Promise<ProcessOutcome> {
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as AnyPgDatabase;
    const [message] = await tx
      .select()
      .from(intakeMessages)
      .where(and(eq(intakeMessages.id, messageId), eq(intakeMessages.parseStatus, "new")))
      .for("update", { skipLocked: true });
    if (!message)
      return { status: "noop" as const, reason: "повідомлення вже оброблене чи обробляється" };
    if (!message.locationId || message.text.trim() === "") {
      await tx
        .update(intakeMessages)
        .set({ parseStatus: "skipped", skipReason: "немає тексту чи локації" })
        .where(eq(intakeMessages.id, message.id));
      return { status: "skipped" as const, reason: "немає тексту чи локації" };
    }
    const author = await authorOf(txDb, message.telegramUserId);
    if (!author) {
      await tx
        .update(intakeMessages)
        .set({ parseStatus: "skipped", skipReason: "відправник не менеджер" })
        .where(eq(intakeMessages.id, message.id));
      return { status: "skipped" as const, reason: "відправник не менеджер" };
    }

    const [location] = await tx
      .select()
      .from(locations)
      .where(eq(locations.id, message.locationId));
    const messageDay = kyivDay(now);
    const dictionaries = await loadDictionaries(txDb);

    // Ліміт викликів: чернетка порожня з текстом заявки (ТЗ 8.3), Claude не питаємо.
    let parsed: ParseResult;
    let response: ClaudeResponse | null = null;
    const limited = (await callsToday(txDb, now)) >= (await dailyLimit(txDb));
    if (limited) {
      parsed = {
        ...EMPTY_PARSE,
        comment: message.text.slice(0, 2000),
        unclear: ["Денний ліміт розбору вичерпано: заповніть замовлення вручну за текстом заявки."],
      };
    } else {
      try {
        const clients = await loadClientLines(txDb, message.locationId);
        const request = buildClaudeRequest({
          locationName: location?.name ?? "",
          messageDay,
          text: message.text,
          clients,
          boxTypes: dictionaries.boxTypes,
          products: dictionaries.products,
        });
        const ask = deps.claude ?? ((r: ClaudeRequest) => callClaude(txDb, r));
        // Відповідь без обов'язкових полів буває випадково (D163): один повтор, далі як помилка.
        let check = null as ReturnType<typeof parseResultSchema.safeParse> | null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const next = await ask(request);
          response = response ? { ...next, usage: addUsage(response.usage, next.usage) } : next;
          check = parseResultSchema.safeParse(next.result);
          if (check.success) break;
        }
        if (!check?.success) throw new ClaudeError("Claude повернув некоректні поля.");
        parsed = check.data;
      } catch (error) {
        if (!(error instanceof ClaudeError)) throw error;
        await tx
          .update(intakeMessages)
          .set({ parseStatus: "failed", parseError: error.message })
          .where(eq(intakeMessages.id, message.id));
        return { status: "failed" as const, reason: error.message };
      }
    }

    const draft = await buildDraft(txDb, parsed, {
      locationId: message.locationId,
      messageDay,
      dictionaries,
    });
    const payload = { parsed, unclear: draft.unclear, isPlaceholder: draft.isPlaceholder };
    const usage = response?.usage;

    let orderId = message.orderId;
    let number: number | null = null;
    let updated = false;
    if (orderId) {
      // Змінене повідомлення: оновлюємо чернетку, лише поки вона чернетка.
      const [existing] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!existing || existing.status !== "draft" || existing.deletedAt) {
        await tx
          .update(intakeMessages)
          .set({
            parseStatus: "parsed",
            parseError: "замовлення вже не чернетка, зміни не застосовано",
          })
          .where(eq(intakeMessages.id, message.id));
        return { status: "noop" as const, reason: "замовлення вже не чернетка" };
      }
      try {
        await updateOrder(txDb, author, orderId, {
          clientId: draft.input.clientId,
          orderDate: draft.input.orderDate,
          iceTypeId: draft.input.iceTypeId,
          kgSold: draft.input.kgSold,
          deliveryMethod: draft.input.deliveryMethod,
          deliveryText: draft.input.deliveryText,
          timeWindow: draft.input.timeWindow,
          recipientName: draft.input.recipientName,
          recipientPhone: draft.input.recipientPhone,
          boxTypeId: draft.input.boxTypeId,
          boxCount: draft.input.boxCount,
          boxOwnership: draft.input.boxOwnership,
          paymentKind: draft.input.paymentKind,
          comment: draft.input.comment,
        });
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await tx
          .update(intakeMessages)
          .set({ parseStatus: "failed", parseError: error.message })
          .where(eq(intakeMessages.id, message.id));
        return { status: "failed" as const, reason: error.message };
      }
      number = existing.number;
      updated = true;
    } else {
      try {
        const created = await createOrder(txDb, author, draft.input);
        orderId = created.id;
        number = created.number;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await tx
          .update(intakeMessages)
          .set({ parseStatus: "failed", parseError: error.message })
          .where(eq(intakeMessages.id, message.id));
        return { status: "failed" as const, reason: error.message };
      }
    }

    await withActor(txDb, author.id, (inner) =>
      inner
        .update(orders)
        .set({
          telegramChatId: message.telegramChatId,
          telegramMessageId: message.telegramMessageId,
          draftPayload: payload,
        })
        .where(eq(orders.id, orderId!)),
    );
    // Кілька днів в одному повідомленні: кожен наступний день окремою чернеткою (D159). Нове
    // повідомлення створює їх, змінене оновлює лише першу чернетку.
    const extraOrderIds: string[] = [];
    if (!updated && !limited) {
      for (const day of parsed.additional_days ?? []) {
        const extra = await buildDraft(
          txDb,
          { ...parsed, order_date: day.order_date, kg_sold: day.kg_sold, delivery_price: null },
          { locationId: message.locationId, messageDay, dictionaries },
        );
        try {
          const createdExtra = await createOrder(txDb, author, extra.input);
          await withActor(txDb, author.id, (inner) =>
            inner
              .update(orders)
              .set({
                telegramChatId: message.telegramChatId,
                telegramMessageId: message.telegramMessageId,
                draftPayload: {
                  parsed,
                  unclear: extra.unclear,
                  isPlaceholder: extra.isPlaceholder,
                  siblingOf: orderId,
                },
              })
              .where(eq(orders.id, createdExtra.id)),
          );
          extraOrderIds.push(createdExtra.id);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          // Не вдалось створити додатковий день: перший уже є, решту менеджер додасть сам.
        }
      }
    }
    await tx
      .update(intakeMessages)
      .set({
        parseStatus: "parsed",
        parseResult: payload,
        parseError: null,
        orderId,
        tokensIn: usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : null,
        tokensOut: usage?.outputTokens ?? null,
        costUsd: usage ? estimateCostUsd(usage).toFixed(5) : null,
      })
      .where(eq(intakeMessages.id, message.id));

    if (limited) return { status: "limit" as const, orderId: orderId!, number };
    return {
      status: "drafted" as const,
      orderId: orderId!,
      number,
      draft,
      updated,
      extraOrderIds,
    };
  });
}
