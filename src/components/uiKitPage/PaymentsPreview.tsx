import type { PaymentView, QueueItem } from "@/server/payment-views";
import { parsePaymentParams } from "@/utils/paymentParams";
import PaymentsContent from "../paymentsPage/PaymentsContent";
import type { PaymentActions } from "../paymentsPage/paymentTypes";
import type { FormAction } from "../clientsPage/clientActions";

export const PAYMENTS_PREVIEW_SCREENS = [
  "payments-queue",
  "payments-statement",
  "payments-bank",
] as const;
export type PaymentsPreviewScreen = (typeof PAYMENTS_PREVIEW_SCREENS)[number];

const payment = (over: Partial<PaymentView> & { id: string }): PaymentView => ({
  occurredAt: new Date("2026-11-23T09:30:00Z"),
  amount: "2250.00",
  counterName: "ТОВ «Кафе Тест»",
  description: "Від: ТОВ «Кафе Тест»",
  comment: null,
  matchStatus: "unmatched",
  ignoredReason: null,
  importedVia: "api",
  unallocated: "2250.00",
  matches: [],
  ...over,
});

const QUEUE: QueueItem[] = [
  {
    payment: payment({ id: "p1", comment: "Оплата за лід, замовлення 1340" }),
    suggestions: [
      {
        orderId: "o1",
        number: 1340,
        clientName: "Кафе Тест",
        orderDate: "2026-11-21",
        remaining: "2250.00",
        reasons: ["number", "name", "amount"],
        apply: "2250.00",
      },
      {
        orderId: "o2",
        number: 1351,
        clientName: "Кафе Тест",
        orderDate: "2026-11-22",
        remaining: "2250.00",
        reasons: ["name", "amount"],
        apply: "2250.00",
      },
    ],
  },
  {
    payment: payment({
      id: "p2",
      amount: "3000.00",
      unallocated: "750.00",
      counterName: "Іванов І. І.",
      matches: [
        {
          orderId: "o3",
          orderNumber: 1338,
          clientName: "Бар Лев",
          amount: "2250.00",
          rule: "manual",
        },
      ],
    }),
    suggestions: [],
  },
];

const STATEMENT = {
  rows: [
    payment({
      id: "p3",
      matchStatus: "auto",
      unallocated: "0.00",
      matches: [
        {
          orderId: "o1",
          orderNumber: 1340,
          clientName: "Кафе Тест",
          amount: "2250.00",
          rule: "comment_number",
        },
      ],
    }),
    payment({
      id: "p4",
      amount: "500.00",
      unallocated: "500.00",
      matchStatus: "ignored",
      ignoredReason: "Переказ між своїми рахунками",
      counterName: "Own",
    }),
  ],
  total: 2,
  page: 1,
  pageSize: 30,
};

/** Екран «Оплати» з вигаданими даними для каталогу `/ui-kit`. */
export default function PaymentsPreview({
  screen,
  formAction,
}: {
  screen: PaymentsPreviewScreen;
  formAction: FormAction;
}) {
  const actions: PaymentActions = {
    sync: formAction,
    match: formAction,
    ignore: formAction,
    restore: formAction,
    unmatch: formAction,
  };
  const tab = screen.replace("payments-", "");
  return (
    <PaymentsContent
      params={parsePaymentParams({ tab })}
      queueCount={QUEUE.length}
      queue={QUEUE}
      statement={STATEMENT}
      monobank={{
        hasToken: true,
        accounts: [
          {
            id: "a1",
            label: "ФОП, гривня",
            lastSyncedAt: new Date("2026-11-23T10:00:00Z"),
            lastError: null,
          },
        ],
      }}
      canSync
      canUnmatch
      actions={actions}
    />
  );
}
