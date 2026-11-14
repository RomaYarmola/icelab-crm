/**
 * Офлайн-черга сканів боксів (B9, ТЗ §9, D112). Кожен скан спершу записується на телефон зі своїм
 * номером і лише потім летить на сервер пакетами по 20. Повторна відправка того ж номера нічого не
 * дублює (сервер ідемпотентний). Тут лише логіка без браузера: сховище й відправка передаються
 * ззовні, тож усе перевіряється тестом.
 */

export const QUEUE_BATCH_SIZE = 20;

export type QueueAction = "issue" | "return";

export type QueueItem = {
  /** Номер скана (uuid): ключ ідемпотентності на сервері. */
  queueId: string;
  code: string;
  action: QueueAction;
  orderId: string | null;
  /** Коли відскановано на пристрої (ISO). */
  occurredAt: string;
  /** `pending` чекає відправки, `attention` сервер відхилив: потрібне рішення людини. */
  state: "pending" | "attention";
  message: string | null;
};

export type QueueStore = {
  all(): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(queueId: string): Promise<void>;
};

/** Відповідь сервера по одному скану (як у `/api/boxes/events`). */
export type SendOutcome = {
  queueId: string | null;
  code: string;
  result: "ok" | "warning" | "error";
  message: string;
  duplicate: boolean;
};

/** Відправка пакета; кидає помилку, якщо зв'язку немає чи сервер не відповів як треба. */
export type SendBatch = (items: QueueItem[]) => Promise<SendOutcome[]>;

export type FlushResult = {
  /** Відповіді сервера для відправлених скан (щоб показати «Видано», «Бокс не знайдено»). */
  outcomes: SendOutcome[];
  /** Зв'язку чи відповіді не було: скани лишились у черзі. */
  failed: boolean;
};

export function newQueueItem(
  input: { code: string; action: QueueAction; orderId: string | null },
  now: Date,
  queueId: string,
): QueueItem {
  return {
    queueId,
    code: input.code,
    action: input.action,
    orderId: input.orderId,
    occurredAt: now.toISOString(),
    state: "pending",
    message: null,
  };
}

/** Скільки скан чекає відправки і скільки потребує уваги. */
export function summarizeQueue(items: readonly QueueItem[]): {
  pending: number;
  attention: number;
} {
  return {
    pending: items.filter((item) => item.state === "pending").length,
    attention: items.filter((item) => item.state === "attention").length,
  };
}

/**
 * Відправляє всі скани, що чекають, пакетами по 20 у порядку часу скану. Успішні (`ok`, `warning`,
 * повторні) видаляються з черги, відхилені помічаються «потребує уваги» з текстом сервера. Якщо
 * зв'язку немає, зупиняємось: решта лишається в черзі до наступної спроби.
 */
export async function flushQueue(store: QueueStore, send: SendBatch): Promise<FlushResult> {
  const pending = (await store.all())
    .filter((item) => item.state === "pending")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const outcomes: SendOutcome[] = [];
  for (let start = 0; start < pending.length; start += QUEUE_BATCH_SIZE) {
    const batch = pending.slice(start, start + QUEUE_BATCH_SIZE);
    let answers: SendOutcome[];
    try {
      answers = await send(batch);
    } catch {
      return { outcomes, failed: true };
    }
    for (const item of batch) {
      const answer = answers.find((a) => a.queueId === item.queueId);
      // Сервер не відповів про цей скан: лишаємо в черзі.
      if (!answer) continue;
      outcomes.push(answer);
      if (answer.result === "error") {
        await store.put({ ...item, state: "attention", message: answer.message });
      } else {
        await store.remove(item.queueId);
      }
    }
  }
  return { outcomes, failed: false };
}

/** Повернути скан, що потребував уваги, у чергу на повторну відправку. */
export async function retryItem(store: QueueStore, queueId: string): Promise<void> {
  const item = (await store.all()).find((x) => x.queueId === queueId);
  if (item) await store.put({ ...item, state: "pending", message: null });
}
