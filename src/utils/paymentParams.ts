import { isIsoDate } from "./isoDate";

/**
 * Стан екрана «Оплати» в адресі (B13): вкладка, фільтри виписки й сторінка. Некоректні значення
 * відкидаємо, щоб ручна правка адреси не ламала екран.
 */

export const PAYMENT_PARAMS = {
  tab: "tab",
  status: "status",
  from: "from",
  to: "to",
  min: "min",
  max: "max",
  page: "page",
} as const;

export const PAYMENT_TABS = ["queue", "statement", "bank"] as const;
export type PaymentTab = (typeof PAYMENT_TABS)[number];

export const STATEMENT_STATUSES = ["unmatched", "auto", "manual", "ignored"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export type PaymentParams = {
  tab: PaymentTab;
  status: StatementStatus | null;
  from: string | null;
  to: string | null;
  /** Сума від і до, гривні (число); `null`, якщо не задано чи некоректне. */
  min: number | null;
  max: number | null;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function amountParam(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value.replace(",", ".").trim());
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parsePaymentParams(raw: RawParams): PaymentParams {
  const tab = first(raw[PAYMENT_PARAMS.tab]);
  const status = first(raw[PAYMENT_PARAMS.status]);
  const from = first(raw[PAYMENT_PARAMS.from]);
  const to = first(raw[PAYMENT_PARAMS.to]);
  const page = Number(first(raw[PAYMENT_PARAMS.page]));
  return {
    tab: (PAYMENT_TABS as readonly string[]).includes(tab ?? "") ? (tab as PaymentTab) : "queue",
    status: (STATEMENT_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as StatementStatus)
      : null,
    from: from && isIsoDate(from) ? from : null,
    to: to && isIsoDate(to) ? to : null,
    min: amountParam(first(raw[PAYMENT_PARAMS.min])),
    max: amountParam(first(raw[PAYMENT_PARAMS.max])),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}
