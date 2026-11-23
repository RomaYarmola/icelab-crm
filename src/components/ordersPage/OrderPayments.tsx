import { formatDateTime } from "@/utils/formatDate";
import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";
import Card from "../shared/cards/Card";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";

export type OrderPaymentView = {
  paymentId: string;
  occurredAt: Date;
  counterName: string | null;
  amount: string;
};

/**
 * Блок «Оплата з банку» в картці замовлення (B13, ТЗ 6.10): які платежі прив'язано. Лише ролі з
 * правом на оплати (власник, бухгалтер); показуємо, коли замовлення оплачується безготівково.
 */
export default function OrderPayments({ payments }: { payments: OrderPaymentView[] }) {
  return (
    <section aria-labelledby="order-payments" className="flex flex-col gap-3">
      <SectionTitle id="order-payments">Оплата з банку</SectionTitle>
      {payments.length === 0 ? (
        <Text variant="muted">Платежів ще не прив’язано.</Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {payments.map((payment) => (
            <Card as="li" key={payment.paymentId} className="flex flex-col gap-0.5">
              <Text className="font-semibold">{formatMoney(parseDecimal(payment.amount))}</Text>
              <Text variant="muted">
                {formatDateTime(payment.occurredAt)}
                {payment.counterName ? ` · ${payment.counterName}` : ""}
              </Text>
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}
