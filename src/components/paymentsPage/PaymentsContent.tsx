import type { MonobankStatus } from "@/server/monobank/status";
import { formatDateTime } from "@/utils/formatDate";
import type { PaymentTab, PaymentParams } from "@/utils/paymentParams";
import type { MonthSummary } from "@/server/month-summary";
import type { ClientDebt, QueueItem, StatementPage } from "@/server/payment-views";
import ActionForm from "../intakePage/ActionForm";
import type { FormAction } from "../clientsPage/clientActions";
import TabLinks from "../shared/tabs/TabLinks";
import DebtsTab from "./DebtsTab";
import ImportTab from "./ImportTab";
import QueueTab from "./QueueTab";
import RequisitesForm from "./RequisitesForm";
import SummaryTab from "./SummaryTab";
import StatementTab from "./StatementTab";
import type { PaymentActions } from "./paymentTypes";
import Card from "../shared/cards/Card";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface PaymentsContentProps {
  params: PaymentParams;
  queueCount: number;
  queue: QueueItem[] | null;
  statement: StatementPage | null;
  debts: ClientDebt[] | null;
  summary: MonthSummary | null;
  month: string;
  debtDays: number;
  requisites: string | null;
  monobank: MonobankStatus;
  canSync: boolean;
  canUnmatch: boolean;
  actions: PaymentActions;
}

/**
 * Екран «Оплати» (B13, ТЗ 6.10): вкладки «Нерозпізнані» (черга з підказками), «Виписка» (фільтри) і
 * «Банк» (підключення monobank: токен «є/немає», рахунок ФОП, остання синхронізація). Борги й
 * зведення за місяць додають наступні кроки.
 */
export default function PaymentsContent({
  params,
  queueCount,
  queue,
  statement,
  debts,
  summary,
  month,
  debtDays,
  requisites,
  monobank,
  canSync,
  canUnmatch,
  actions,
}: PaymentsContentProps) {
  const syncAction: FormAction = actions.sync;
  const tabs: { id: PaymentTab; label: string }[] = [
    { id: "queue", label: queueCount > 0 ? `Нерозпізнані · ${queueCount}` : "Нерозпізнані" },
    { id: "statement", label: "Виписка" },
    { id: "debts", label: "Борги" },
    { id: "summary", label: "Зведення" },
    ...(canSync ? [{ id: "import" as const, label: "Імпорт" }] : []),
    { id: "bank", label: "Банк" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <TabLinks
        label="Розділи оплат"
        activeId={params.tab}
        items={tabs.map((tab) => ({ ...tab, href: `/payments?tab=${tab.id}` }))}
      />
      {params.tab === "queue" && queue ? <QueueTab items={queue} actions={actions} /> : null}
      {params.tab === "statement" && statement ? (
        <StatementTab
          statement={statement}
          params={params}
          canUnmatch={canUnmatch}
          actions={actions}
        />
      ) : null}
      {params.tab === "debts" && debts ? (
        <DebtsTab debts={debts} requisites={requisites} debtDays={debtDays} />
      ) : null}
      {params.tab === "summary" && summary ? <SummaryTab summary={summary} month={month} /> : null}
      {params.tab === "import" && canSync ? <ImportTab actions={actions} /> : null}
      {params.tab === "bank" ? (
        <section aria-labelledby="payments-bank" className="flex max-w-xl flex-col gap-3">
          <SectionTitle id="payments-bank">Банк (monobank)</SectionTitle>
          {monobank.hasToken ? (
            <Notification variant="success">Токен monobank налаштовано.</Notification>
          ) : (
            <Notification variant="warning" title="Токен не налаштований">
              Додайте у змінні середовища сервера токен monobank (MONOPAY_API_KEY) і перезапустіть
              застосунок. На екрані він не показується.
            </Notification>
          )}
          <Text variant="muted">
            Забираємо лише надходження на рахунок ФОП. Особисті картки з того ж токена не зберігаємо
            й не читаємо.
          </Text>
          {monobank.accounts.length === 0 ? (
            <Text variant="muted">Рахунок ще не підключено: натисніть кнопку нижче.</Text>
          ) : (
            <ul className="flex flex-col gap-3">
              {monobank.accounts.map((account) => (
                <Card as="li" key={account.id} className="flex flex-col gap-1">
                  <Text variant="label">{account.label}</Text>
                  <Text variant="muted">
                    {account.lastSyncedAt
                      ? `Остання перевірка: ${formatDateTime(account.lastSyncedAt)}`
                      : "Ще не перевіряли."}
                  </Text>
                  {account.lastError ? (
                    <Text variant="muted">Помилка: {account.lastError}</Text>
                  ) : null}
                </Card>
              ))}
            </ul>
          )}
          {canSync ? <RequisitesForm requisites={requisites} action={actions.requisites} /> : null}
          {canSync ? (
            <ActionForm
              action={syncAction}
              label="Перевірити з’єднання й забрати виписку"
              loadingText="Забираємо…"
              disabled={!monobank.hasToken}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
