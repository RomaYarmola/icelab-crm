import type { UserRole } from "./permissions";

/**
 * Правила станів оборотного бокса (B9, D106, ТЗ 5.2). Чисті функції без бази: на вхід стан бокса й
 * дія, на вихід новий стан, подія для журналу, попередження чи помилка. Усі переходи ТЗ тут, в одному
 * місці, і кожен має тест.
 */

export type BoxStatus = "in_stock" | "at_client" | "sold" | "lost" | "retired";

export type BoxEventKind =
  | "created"
  | "label_printed"
  | "issued"
  | "returned"
  | "sold"
  | "lost"
  | "found"
  | "transferred"
  | "note";

/** Що можна зробити з боксом. */
export type BoxAction = "issue" | "return" | "sell" | "lose" | "find" | "retire" | "transfer";

export const BOX_STATUS_LABELS: Record<BoxStatus, string> = {
  in_stock: "На складі",
  at_client: "У клієнта",
  sold: "Продано",
  lost: "Втрачено",
  retired: "Списано",
};

export type BoxState = {
  status: BoxStatus;
  currentClientId: string | null;
  currentOrderId: string | null;
};

/** Замовлення, до якого видаємо бокс чи продаємо його. */
export type BoxOrderRef = { id: string; clientId: string };

/** Подія, яку треба записати (разом з основною може бути ще одна: неявне повернення). */
export type PlannedEvent = {
  event: BoxEventKind;
  clientId: string | null;
  orderId: string | null;
  note?: string;
};

export type BoxTransition =
  | {
      ok: true;
      /** Новий стан бокса. */
      next: BoxState;
      /** Події в порядку запису: спершу неявне повернення від попереднього клієнта, потім основна. */
      events: PlannedEvent[];
      /** Дію прийнято, але користувача треба попередити. */
      warning?: string;
      /** Скарга не потрібна: нічого не змінилось (повторний скан). */
      unchanged?: boolean;
    }
  | { ok: false; error: string };

/** Ролі, які можуть виконати дію (ТЗ 2.2 і 5.2). Локацію (свою) перевіряє серверна функція. */
const ACTION_ROLES: Record<BoxAction, readonly UserRole[]> = {
  issue: ["owner", "location_lead", "production"],
  return: ["owner", "location_lead", "production"],
  find: ["owner", "location_lead", "production"],
  sell: ["owner", "location_lead"],
  lose: ["owner"],
  retire: ["owner"],
  transfer: ["owner"],
};

export function canDoBoxAction(role: UserRole, action: BoxAction): boolean {
  return ACTION_ROLES[action].includes(role);
}

const CLEARED = { currentClientId: null, currentOrderId: null } as const;

const fail = (error: string): BoxTransition => ({ ok: false, error });

/**
 * Застосовує дію до бокса. `order` потрібне для видачі й продажу (замовлення, до якого це належить).
 * Правила з ТЗ 5.2:
 *  - видача: «На складі» → «У клієнта»; якщо бокс числиться в іншого клієнта, дозволено з
 *    попередженням і система сама пише повернення від попереднього клієнта (бокс фізично на складі);
 *  - повернення: «У клієнта» → «На складі»; повторний скан бокса, що вже на складі, лише примітка;
 *  - продаж: «На складі» чи «У клієнта» → «Продано»;
 *  - втрата: «У клієнта» → «Втрачено»; «знайдено»: «Втрачено» → «На складі»;
 *  - списання: «На складі» чи «Втрачено» → «Списано».
 */
export function applyBoxAction(
  box: BoxState,
  action: BoxAction,
  order?: BoxOrderRef | null,
): BoxTransition {
  switch (action) {
    case "issue": {
      if (!order) return fail("Для видачі оберіть замовлення.");
      if (box.status === "sold") return fail("Бокс проданий, видати його не можна.");
      if (box.status === "retired") return fail("Бокс списаний, видати його не можна.");
      if (box.status === "lost")
        return fail("Бокс числиться втраченим. Спершу позначте «знайдено».");
      const issued: PlannedEvent = {
        event: "issued",
        clientId: order.clientId,
        orderId: order.id,
      };
      const next: BoxState = {
        status: "at_client",
        currentClientId: order.clientId,
        currentOrderId: order.id,
      };
      if (box.status === "at_client") {
        if (box.currentOrderId === order.id) return fail("Бокс уже у цьому замовленні.");
        return {
          ok: true,
          next,
          events: [
            {
              event: "returned",
              clientId: box.currentClientId,
              orderId: box.currentOrderId,
              note: "Автоматично: бокс видано іншому клієнтові",
            },
            issued,
          ],
          warning:
            box.currentClientId === order.clientId
              ? "Бокс числився в цього клієнта за іншим замовленням: записано його повернення."
              : "Бокс числився в іншого клієнта: записано його повернення й видано в це замовлення.",
        };
      }
      return { ok: true, next, events: [issued] };
    }

    case "return": {
      if (box.status === "in_stock") {
        return {
          ok: true,
          next: box,
          events: [{ event: "note", clientId: null, orderId: null, note: "повторний скан" }],
          unchanged: true,
          warning: "Бокс уже на складі: повторний скан записано приміткою.",
        };
      }
      if (box.status !== "at_client") {
        return fail(
          `Бокс має статус «${BOX_STATUS_LABELS[box.status]}»: повернення не записується.`,
        );
      }
      return {
        ok: true,
        next: { status: "in_stock", ...CLEARED },
        events: [{ event: "returned", clientId: box.currentClientId, orderId: box.currentOrderId }],
      };
    }

    case "sell": {
      if (box.status !== "in_stock" && box.status !== "at_client") {
        return fail(`Бокс має статус «${BOX_STATUS_LABELS[box.status]}»: продати його не можна.`);
      }
      return {
        ok: true,
        next: { status: "sold", ...CLEARED },
        events: [
          {
            event: "sold",
            clientId: order?.clientId ?? box.currentClientId,
            orderId: order?.id ?? box.currentOrderId,
          },
        ],
      };
    }

    case "lose": {
      if (box.status !== "at_client")
        return fail("Втраченим можна позначити лише бокс «У клієнта».");
      return {
        ok: true,
        next: { status: "lost", ...CLEARED },
        events: [{ event: "lost", clientId: box.currentClientId, orderId: box.currentOrderId }],
      };
    }

    case "find": {
      if (box.status !== "lost") return fail("«Знайдено» можна позначити лише втрачений бокс.");
      return {
        ok: true,
        next: { status: "in_stock", ...CLEARED },
        events: [{ event: "found", clientId: null, orderId: null }],
      };
    }

    case "retire": {
      if (box.status !== "in_stock" && box.status !== "lost") {
        return fail("Списати можна лише бокс «На складі» чи «Втрачено».");
      }
      return {
        ok: true,
        next: { status: "retired", ...CLEARED },
        events: [{ event: "note", clientId: null, orderId: null, note: "Списано" }],
      };
    }

    case "transfer": {
      if (box.status !== "in_stock") return fail("Перемістити можна лише бокс «На складі».");
      return {
        ok: true,
        next: box,
        events: [{ event: "transferred", clientId: null, orderId: null }],
      };
    }
  }
}

/** Статуси замовлення, у яких до нього видають бокси (ТЗ 6.7: «У виробництві» й «Запаковано»). */
export const BOX_ISSUE_ORDER_STATUSES = ["in_production", "packed"] as const;

export function canIssueBoxesToOrder(status: string): boolean {
  return (BOX_ISSUE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Код бокса за префіксом локації й номером: `K-0001`, після 9999 п'ять цифр. */
export function formatBoxCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/** Номер з коду `K-0012` → 12, інакше `null`. */
export function boxCodeSequence(code: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}-(\\d{4,})$`).exec(code);
  return match ? Number(match[1]) : null;
}

/** Код з QR: приймає «K-0001», адресу `.../b/K-0001` і пробіли; повертає код у верхньому регістрі. */
export function parseBoxCode(raw: string): string | null {
  const text = raw.trim();
  const fromUrl = /\/b\/([A-Za-z]-\d{4,})\/?(?:[?#].*)?$/.exec(text);
  const candidate = (fromUrl ? fromUrl[1]! : text).toUpperCase();
  return /^[A-Z]-\d{4,}$/.test(candidate) ? candidate : null;
}
