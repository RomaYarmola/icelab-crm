import type { CashDaySummary } from "@/server/cash";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import Card from "../shared/cards/Card";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";

interface CashSummaryProps {
  summary: CashDaySummary;
}

const money = (value: string) => formatMoney(parseDecimal(value));

/**
 * Каса за день (ТЗ 6.6): «мало надійти», «внесено», «різниця» по готівкових замовленнях дня і, окремо,
 * скільки прийнято саме цього дня та хто приймав. Суми загальні, без цін за кг.
 */
export default function CashSummary({ summary }: CashSummaryProps) {
  return (
    <section aria-labelledby="cash-summary" className="flex flex-col gap-3">
      <SubTitle id="cash-summary">Каса за день</SubTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-0.5">
          <Text variant="muted">Мало надійти</Text>
          <Text variant="kpi" className="font-extrabold">
            {money(summary.expectedSum)}
          </Text>
        </Card>
        <Card className="flex flex-col gap-0.5">
          <Text variant="muted">Внесено</Text>
          <Text variant="kpi" className="font-extrabold">
            {money(summary.enteredSum)}
          </Text>
        </Card>
        <Card className="flex flex-col gap-0.5">
          <Text variant="muted">Різниця</Text>
          <Text variant="kpi" className="font-extrabold">
            {money(summary.differenceSum)}
          </Text>
        </Card>
      </div>
      <Text variant="muted">
        Прийнято цього дня: {money(summary.receivedOnDaySum)}
        {summary.byReceiver.length > 0
          ? ` (${summary.byReceiver
              .map((item) => `${item.name}: ${money(item.sumReceived)}`)
              .join(", ")})`
          : ""}
      </Text>
    </section>
  );
}
