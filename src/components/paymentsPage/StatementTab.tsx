import Link from "next/link";
import { PAYMENT_MATCH_STATUS_LABELS } from "@/server/audit-labels";
import type { StatementPage } from "@/server/payment-views";
import { PAYMENT_PARAMS, type PaymentParams } from "@/utils/paymentParams";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import { RestoreForm, ReasonForm } from "./MatchForms";
import PaymentCard from "./PaymentCard";
import type { PaymentActions } from "./paymentTypes";
import StatementFilters from "./StatementFilters";

interface StatementTabProps {
  statement: StatementPage;
  params: PaymentParams;
  canUnmatch: boolean;
  actions: PaymentActions;
}

const STATUS_OPTIONS = Object.entries(PAYMENT_MATCH_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function pageHref(params: PaymentParams, page: number): string {
  const search = new URLSearchParams({ [PAYMENT_PARAMS.tab]: "statement" });
  if (params.status) search.set(PAYMENT_PARAMS.status, params.status);
  if (params.from) search.set(PAYMENT_PARAMS.from, params.from);
  if (params.to) search.set(PAYMENT_PARAMS.to, params.to);
  if (params.min !== null) search.set(PAYMENT_PARAMS.min, String(params.min));
  if (params.max !== null) search.set(PAYMENT_PARAMS.max, String(params.max));
  if (page > 1) search.set(PAYMENT_PARAMS.page, String(page));
  return `/payments?${search.toString()}`;
}

/** Вкладка «Виписка»: усі платежі з фільтрами за статусом, днем і сумою (ТЗ 6.10). */
export default function StatementTab({
  statement,
  params,
  canUnmatch,
  actions,
}: StatementTabProps) {
  const activeFilters = [params.status, params.from, params.to, params.min, params.max].filter(
    (value) => value !== null,
  ).length;
  const pages = Math.max(1, Math.ceil(statement.total / statement.pageSize));
  return (
    <div className="flex flex-col gap-4">
      <StatementFilters
        statusOptions={STATUS_OPTIONS}
        activeCount={activeFilters}
        params={params}
      />
      <Text variant="muted">Платежів: {statement.total}</Text>
      {statement.rows.length === 0 ? (
        <EmptyState
          title="Платежів немає"
          description={activeFilters > 0 ? "Змініть фільтри." : "Виписка ще порожня."}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {statement.rows.map((payment) => (
            <PaymentCard key={payment.id} payment={payment}>
              {payment.matchStatus === "ignored" ? (
                <RestoreForm paymentId={payment.id} action={actions.restore} />
              ) : null}
              {canUnmatch && payment.matches.length > 0 ? (
                <ReasonForm
                  paymentId={payment.id}
                  action={actions.unmatch}
                  summary="Скасувати зіставлення"
                  button="Скасувати зіставлення"
                  loadingText="Скасовуємо…"
                  hint="Лише якщо замовлення ще не оплачене."
                />
              ) : null}
            </PaymentCard>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav aria-label="Сторінки виписки" className="flex items-center justify-between gap-3">
          {statement.page > 1 ? (
            <Link
              href={pageHref(params, statement.page - 1)}
              className="text-body font-semibold text-navy"
            >
              ← Новіші
            </Link>
          ) : (
            <span />
          )}
          <Text variant="muted">
            Сторінка {statement.page} з {pages}
          </Text>
          {statement.page < pages ? (
            <Link
              href={pageHref(params, statement.page + 1)}
              className="text-body font-semibold text-navy"
            >
              Старіші →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
