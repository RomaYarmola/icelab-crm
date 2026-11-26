import type { PaymentView, QueueItem } from "@/server/payment-views";
import { parsePaymentParams } from "@/utils/paymentParams";
import PaymentsContent from "../paymentsPage/PaymentsContent";
import type { ImportActionResult } from "@/app/(app)/payments/actions";
import type { PaymentActions } from "../paymentsPage/paymentTypes";
import type { FormAction } from "../clientsPage/clientActions";

export const PAYMENTS_PREVIEW_SCREENS = [
  "payments-queue",
  "payments-statement",
  "payments-debts",
  "payments-summary",
  "payments-import",
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
    named: [
      { number: 1340, orderId: "o1", clientName: "Кафе Тест", remaining: "2250.00", problem: null },
      { number: 1351, orderId: "o2", clientName: "Кафе Тест", remaining: "2250.00", problem: null },
      { number: 99999, orderId: null, clientName: null, remaining: null, problem: "не знайдено." },
    ],
    clientOrders: [
      {
        orderId: "o1",
        number: 1340,
        clientName: "Кафе Тест",
        orderDate: "2026-11-21",
        remaining: "2250.00",
      },
    ],
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
    named: [],
    clientOrders: [],
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

const SUMMARY_TOTALS = {
  orders: 4,
  kg: "120",
  ice: "9000.00",
  delivery: "300.00",
  boxes: "1000.00",
  other: "900.00",
  total: "11200.00",
  paid: "8950.00",
  debt: "2250.00",
};

const SUMMARY = {
  month: "2026-11",
  dateFrom: "2026-11-01",
  dateTo: "2026-11-30",
  locationId: null,
  totals: SUMMARY_TOTALS,
  locations: [{ locationId: "l1", locationName: "Київ", ...SUMMARY_TOTALS }],
  clients: [
    { clientId: "c1", clientName: "Кафе Тест", clientCode: "КТ21", ...SUMMARY_TOTALS },
    {
      clientId: "c2",
      clientName: "Бар Лев",
      clientCode: "БЛ12",
      ...SUMMARY_TOTALS,
      orders: 1,
      kg: "30",
      total: "2250.00",
      paid: "2250.00",
      debt: "0.00",
    },
  ],
};

const DEBTS = [
  {
    clientId: "c1",
    clientName: "Кафе Тест",
    clientCode: "КТ21",
    total: "4500.00",
    orders: [
      {
        id: "o1",
        number: 1340,
        orderDate: "2026-11-21",
        remaining: "2250.00",
        days: 2,
        deliveryMethod: "np" as const,
      },
      {
        id: "o2",
        number: 1351,
        orderDate: "2026-11-22",
        remaining: "2250.00",
        days: 1,
        deliveryMethod: "our_delivery" as const,
      },
    ],
  },
];

/** Екран «Оплати» з вигаданими даними для каталогу `/ui-kit`. */
export default function PaymentsPreview({
  screen,
  formAction,
  importAction,
  linksAction,
}: {
  screen: PaymentsPreviewScreen;
  formAction: FormAction;
  importAction: (formData: FormData) => Promise<ImportActionResult<never>>;
  linksAction: PaymentActions["createLinks"];
}) {
  const actions: PaymentActions = {
    sync: formAction,
    match: formAction,
    ignore: formAction,
    restore: formAction,
    unmatch: formAction,
    byNumbers: formAction,
    selected: formAction,
    requisites: formAction,
    linkAccount: formAction,
    createLinks: linksAction,
    importPreview: importAction,
    importCommit: importAction,
  };
  const tab = screen.replace("payments-", "");
  return (
    <PaymentsContent
      params={parsePaymentParams({ tab })}
      queueCount={QUEUE.length}
      queue={QUEUE}
      debts={DEBTS}
      summary={SUMMARY}
      month="2026-11"
      debtDays={1}
      requisites={"Отримувач: ФОП Тестовий Тест Тестович\nРахунок: UA000000000000000000000000000"}
      statement={STATEMENT}
      hasLinkKey
      linkStatus={{
        hasKey: true,
        accounts: [{ uid: "a1", label: "ФОП Тестовий Тест, рахунок …0000" }],
        selectedUid: "a1",
        error: null,
      }}
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
