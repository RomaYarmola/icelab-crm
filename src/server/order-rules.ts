import type { OrderStatus } from "@/constants/constants";
import type { UserRole } from "./permissions";

/**
 * Правила замовлень (D51, D53, D56, D58): переходи статусів, хто що може змінювати, надбавка,
 * закриття, дублі. Чисті функції без бази й Next: їх легко перевірити таблицею (шість ролей на
 * вісім статусів). Права за матрицею B2 і локацію записів перевіряє сервер окремо, тут лише
 * бізнес-правила роздільно від доступу до даних (D14).
 */

/** Хто виконує перехід: роль користувача або система (автозакриття). */
export type Performer = UserRole | "system";

/** Основний ланцюжок статусів. Скасування стоїть поза ним. */
export const STATUS_FLOW = [
  "draft",
  "confirmed",
  "in_production",
  "packed",
  "shipped",
  "paid",
  "closed",
] as const satisfies readonly OrderStatus[];

export type FlowStatus = (typeof STATUS_FLOW)[number];

export type TransitionKind = "forward" | "back" | "cancel";

const isFlowStatus = (status: OrderStatus): status is FlowStatus =>
  (STATUS_FLOW as readonly string[]).includes(status);

/** Наступний статус у ланцюжку (`null` для останнього, скасованого й невідомого). */
export function nextStatus(status: OrderStatus): FlowStatus | null {
  if (!isFlowStatus(status)) return null;
  return STATUS_FLOW[STATUS_FLOW.indexOf(status) + 1] ?? null;
}

/** Попередній статус у ланцюжку (`null` для чернетки, скасованого й невідомого). */
export function previousStatus(status: OrderStatus): FlowStatus | null {
  if (!isFlowStatus(status)) return null;
  return STATUS_FLOW[STATUS_FLOW.indexOf(status) - 1] ?? null;
}

/**
 * Хто виконує крок вперед до статусу (D51). «Оплачено» до B13 і готівки (B6) ставить власник
 * вручну; «Закрито» лише система, коли замовлення оплачене й боргів по боксах немає.
 */
const FORWARD_PERFORMERS: Record<Exclude<FlowStatus, "draft">, readonly Performer[]> = {
  confirmed: ["owner", "manager"],
  in_production: ["owner", "location_lead", "production"],
  packed: ["owner", "location_lead", "production"],
  shipped: ["owner", "manager", "location_lead"],
  paid: ["owner"],
  closed: ["system"],
};

/** Скасувати до «Відправлено» можуть власник і менеджер, пізніше лише власник. */
const CANCEL_BEFORE_SHIPPED: readonly Performer[] = ["owner", "manager"];
const CANCEL_AFTER_SHIPPED: readonly Performer[] = ["owner"];
const CANCELLABLE_BEFORE_SHIPPED: readonly OrderStatus[] = [
  "draft",
  "confirmed",
  "in_production",
  "packed",
];
const CANCELLABLE_AFTER_SHIPPED: readonly OrderStatus[] = ["shipped", "paid"];

/** Крок назад лише власник (з приміткою). */
const BACK_PERFORMERS: readonly Performer[] = ["owner"];

export type Transition = { from: OrderStatus; to: OrderStatus; kind: TransitionKind };

export type TransitionCheck =
  | { ok: true; kind: TransitionKind; needsNote: boolean }
  /** `forbidden`: роль не може; `invalid`: такого переходу немає (пропуск статусу, той самий статус). */
  | { ok: false; reason: string; code: "forbidden" | "invalid" };

/** Чи потрібна примітка: причина скасування, причина кроку назад, ручне «Оплачено» (D51). */
function needsNote(kind: TransitionKind, to: OrderStatus): boolean {
  return kind === "cancel" || kind === "back" || to === "paid";
}

const NOT_ALLOWED = "Цей перехід недоступний.";
const NOT_FOR_ROLE = "Ця роль не може виконати цей перехід.";

/**
 * Чи можна перевести замовлення зі статусу `from` у `to`. Кроки вперед лише на один статус, без
 * пропусків; скасування з будь-якого незавершеного; назад лише власник. Повертає, чи потрібна
 * примітка.
 */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  performer: Performer,
): TransitionCheck {
  if (from === to) return { ok: false, reason: NOT_ALLOWED, code: "invalid" };

  if (to === "cancelled") {
    if (CANCELLABLE_BEFORE_SHIPPED.includes(from)) {
      return CANCEL_BEFORE_SHIPPED.includes(performer)
        ? { ok: true, kind: "cancel", needsNote: true }
        : { ok: false, reason: NOT_FOR_ROLE, code: "forbidden" };
    }
    if (CANCELLABLE_AFTER_SHIPPED.includes(from)) {
      return CANCEL_AFTER_SHIPPED.includes(performer)
        ? { ok: true, kind: "cancel", needsNote: true }
        : {
            ok: false,
            reason: "Після відправлення скасувати замовлення може лише власник.",
            code: "forbidden",
          };
    }
    return { ok: false, reason: NOT_ALLOWED, code: "invalid" };
  }

  if (!isFlowStatus(from) || !isFlowStatus(to))
    return { ok: false, reason: NOT_ALLOWED, code: "invalid" };

  if (nextStatus(from) === to) {
    const allowed = FORWARD_PERFORMERS[to as Exclude<FlowStatus, "draft">];
    return allowed.includes(performer)
      ? { ok: true, kind: "forward", needsNote: needsNote("forward", to) }
      : { ok: false, reason: NOT_FOR_ROLE, code: "forbidden" };
  }

  if (previousStatus(from) === to && from !== "draft") {
    return BACK_PERFORMERS.includes(performer)
      ? { ok: true, kind: "back", needsNote: true }
      : {
          ok: false,
          reason: "Повернути замовлення на крок назад може лише власник.",
          code: "forbidden",
        };
  }

  return { ok: false, reason: NOT_ALLOWED, code: "invalid" };
}

/** Усі переходи, доступні виконавцю зі статусу (для кнопок на картці). */
export function allowedTransitions(from: OrderStatus, performer: Performer): Transition[] {
  const targets: OrderStatus[] = [];
  const next = nextStatus(from);
  const previous = previousStatus(from);
  if (next) targets.push(next);
  if (previous) targets.push(previous);
  targets.push("cancelled");

  return targets.flatMap((to) => {
    const check = checkTransition(from, to, performer);
    return check.ok ? [{ from, to, kind: check.kind }] : [];
  });
}

/**
 * Які мітки часу ставить перехід у статус (`orders.confirmed_at` тощо). Назад ці мітки знімаємо
 * зі статусу, який залишили. `in_production` міток не має: старий `seen_by_production_at` веде
 * екран виробництва (B6).
 */
export const STATUS_TIMESTAMP_COLUMN = {
  confirmed: "confirmedAt",
  packed: "packedAt",
  shipped: "shippedAt",
  paid: "paidAt",
  closed: "closedAt",
} as const;

// ---------------------------------------------------------------------------------------------
// Що можна змінювати (D58)
// ---------------------------------------------------------------------------------------------

export type CoreEdit = "free" | "owner_note" | "none";

export type EditPolicy = {
  /**
   * Основні поля (клієнт, дата, тип льоду, кг, доставка, адреса, тара, оплата, позиції):
   * `free` у чернетці й підтвердженому для власника та менеджера, `owner_note` у виробництві й
   * запакованому (лише власник із приміткою), `none` далі.
   */
  core: CoreEdit;
  /** Ціна: `free` у чернетці (власник, менеджер), `override` після підтвердження лише власник із приміткою. */
  price: "free" | "override" | "none";
  /** «Виготовити»: власник і менеджер, старший локації (своєї локації) після підтвердження. */
  produce: boolean;
  /** Коментар для виробництва. */
  comment: boolean;
  /** Внутрішній коментар: лише власник і менеджер. */
  internalComment: boolean;
};

const NONE: EditPolicy = {
  core: "none",
  price: "none",
  produce: false,
  comment: false,
  internalComment: false,
};

/** Що може змінювати роль у замовленні зі статусом (D58). Локацію запису сервер перевіряє окремо. */
export function editPolicy(status: OrderStatus, role: UserRole): EditPolicy {
  if (status === "cancelled" || status === "closed") return NONE;

  const isOffice = role === "owner" || role === "manager";

  if (role === "location_lead") {
    // Старший локації змінює лише «виготовити» і коментар для виробництва (D58).
    return {
      ...NONE,
      produce: status !== "draft" && status !== "shipped" && status !== "paid",
      comment: status !== "draft",
    };
  }
  if (!isOffice) return NONE;

  const afterShipping = status === "shipped" || status === "paid";
  const core: CoreEdit =
    status === "draft" || status === "confirmed"
      ? "free"
      : status === "in_production" || status === "packed"
        ? role === "owner"
          ? "owner_note"
          : "none"
        : "none";
  const price: EditPolicy["price"] =
    status === "draft" ? "free" : role === "owner" ? "override" : "none";

  return {
    core,
    price,
    produce: !afterShipping,
    comment: true,
    internalComment: true,
  };
}

/** Видалити (м'яко) можна лише чернетку, власник і менеджер (D58). */
export function canDeleteDraft(status: OrderStatus, role: UserRole): boolean {
  return status === "draft" && (role === "owner" || role === "manager");
}

// ---------------------------------------------------------------------------------------------
// Надбавка (D53)
// ---------------------------------------------------------------------------------------------

export type MarkupSettings = {
  /** `markup.np_percent`: Нова Пошта. */
  npPercent: number;
  /** `markup.event_percent`: «Важкий дим» і «Дитячі свята». */
  eventPercent: number;
};

export const DEFAULT_MARKUP_SETTINGS: MarkupSettings = { npPercent: 10, eventPercent: 10 };

/** Коди застосувань клієнта, для яких діє надбавка за подію (`client_applications.code`). */
export const EVENT_APPLICATION_CODES = ["heavy_smoke", "kids_parties"] as const;

/**
 * Надбавка в відсотках для підказки «виготовити»: окрема надбавка клієнта, якщо вона задана,
 * інакше більша з двох (Нова Пошта, застосування «Важкий дим» чи «Дитячі свята»), інакше 0.
 * Лише підказка: менеджер чи старший локації можуть змінити число (відповідь Романа Б2.2).
 */
export function suggestMarkupPercent(input: {
  deliveryMethod: string;
  applicationCode: string | null;
  clientOverridePercent: number | null;
  settings?: MarkupSettings;
}): number {
  if (input.clientOverridePercent !== null && Number.isFinite(input.clientOverridePercent)) {
    return input.clientOverridePercent;
  }
  const settings = input.settings ?? DEFAULT_MARKUP_SETTINGS;
  const candidates = [0];
  if (input.deliveryMethod === "np") candidates.push(settings.npPercent);
  if (
    input.applicationCode &&
    (EVENT_APPLICATION_CODES as readonly string[]).includes(input.applicationCode)
  ) {
    candidates.push(settings.eventPercent);
  }
  return Math.max(...candidates);
}

// ---------------------------------------------------------------------------------------------
// Закриття і дублі (D51, D56)
// ---------------------------------------------------------------------------------------------

/**
 * Замовлення закривається, коли воно оплачене й за ним немає боргу по боксах (D51). Боргів по
 * боксах до блока B9 немає, тож `boxDebts` типово 0 і закриття залежить лише від оплати.
 */
export function isReadyToClose(order: { status: OrderStatus }, boxDebts = 0): boolean {
  return order.status === "paid" && boxDebts === 0;
}

type DuplicateKey = {
  id?: string;
  clientId: string;
  orderDate: string;
  iceTypeId: string | null;
  status: OrderStatus;
  deleted?: boolean;
};

/**
 * Чи схоже замовлення `other` на `order` (D56): той самий клієнт, та сама дата виконання й той самий
 * тип льоду, і воно не скасоване та не видалене. Саме з собою замовлення не збігається.
 */
export function isLikelyDuplicate(order: DuplicateKey, other: DuplicateKey): boolean {
  if (order.id !== undefined && order.id === other.id) return false;
  if (other.status === "cancelled" || other.deleted) return false;
  return (
    order.clientId === other.clientId &&
    order.orderDate === other.orderDate &&
    order.iceTypeId === other.iceTypeId
  );
}
