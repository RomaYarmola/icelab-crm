import type { MonobankStatus } from "@/server/monobank/status";
import { formatDateTime } from "@/utils/formatDate";
import ActionForm from "../intakePage/ActionForm";
import type { FormAction } from "../clientsPage/clientActions";
import Card from "../shared/cards/Card";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

interface PaymentsContentProps {
  monobank: MonobankStatus;
  canSync: boolean;
  syncAction: FormAction;
}

/**
 * Екран «Оплати» (B13). Поки що: підключення monobank (токен «є/немає», рахунок ФОП, остання
 * синхронізація, кнопка «Перевірити з'єднання»). Виписку, чергу й борги додають наступні кроки.
 */
export default function PaymentsContent({ monobank, canSync, syncAction }: PaymentsContentProps) {
  return (
    <div className="flex flex-col gap-8">
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
          Забираємо лише надходження на рахунок ФОП. Особисті картки з того ж токена не зберігаємо й
          не читаємо.
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
        {canSync ? (
          <ActionForm
            action={syncAction}
            label="Перевірити з’єднання й забрати виписку"
            loadingText="Забираємо…"
            disabled={!monobank.hasToken}
          />
        ) : null}
      </section>
    </div>
  );
}
