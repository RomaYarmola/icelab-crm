import type { Analytics } from "@/server/analytics";
import type { BoxAnalytics, DeliveryAnalytics } from "@/server/analytics-sales";
import type { AnalyticsTab } from "@/utils/analyticsParams";
import AnalyticsContent from "../analyticsPage/AnalyticsContent";
import AnalyticsShell from "../analyticsPage/AnalyticsShell";
import BoxesContent from "../analyticsPage/BoxesContent";
import DeliveryContent from "../analyticsPage/DeliveryContent";

const m = (kg: number, uah: string, orders = 3) => ({ kg, uah, orders });

const DATA: Analytics = {
  from: "2026-07",
  to: "2026-11",
  ownOnly: false,
  totals: m(1840, "138000.00", 52),
  months: [
    { month: "2026-07", ...m(520, "39000.00", 14) },
    { month: "2026-08", ...m(610, "45750.00", 16) },
    { month: "2026-09", ...m(340, "25500.00", 10) },
    { month: "2026-10", ...m(210, "15750.00", 7) },
    { month: "2026-11", ...m(160, "12000.00", 5) },
  ],
  clients: [
    {
      clientId: "c1",
      clientName: "ДСВ Логістика",
      clientCode: "ДЛ11",
      ...m(900, "67500.00", 20),
      lastMonth: m(80, "6000.00", 2),
      previousMonth: m(60, "4500.00", 2),
    },
    {
      clientId: "c2",
      clientName: "Кафе «Вогник» з дуже довгою назвою для перевірки",
      clientCode: "КВ12",
      ...m(420, "31500.00", 14),
      lastMonth: m(0, "0.00", 0),
      previousMonth: m(60, "4500.00", 2),
    },
  ],
  byManager: [{ key: "u1", label: "Марія Менеджер", ...m(900, "67500.00", 20) }],
  byIceType: [{ key: "16", label: "16 мм", ...m(1500, "112500.00", 40) }],
  byApplication: [{ key: "a", label: "Логістика", ...m(900, "67500.00", 20) }],
  bySource: [{ key: "—", label: "Не вказано", ...m(340, "25500.00", 12) }],
};

const BOXES: BoxAnalytics = {
  from: "2026-10",
  to: "2026-11",
  ownOnly: false,
  totals: { count: 12, uah: "6900.00" },
  revenueShare: 5.2,
  months: [
    { month: "2026-10", count: 8, uah: "4300.00" },
    { month: "2026-11", count: 4, uah: "2600.00" },
  ],
  byType: [
    { key: "s", label: "Малий 19 л", count: 9, uah: "4500.00" },
    { key: "l", label: "Довгий 46 л", count: 3, uah: "2400.00" },
  ],
  byClient: [{ key: "c1", label: "ДСВ Логістика", count: 7, uah: "3900.00" }],
  byManager: [{ key: "u1", label: "Марія Менеджер", count: 12, uah: "6900.00" }],
};

const counts = (pickup: number, own: number, np: number) => ({
  pickup,
  our_delivery: own,
  np,
  bus: 0,
  other: 0,
});

const DELIVERY: DeliveryAnalytics = {
  from: "2026-10",
  to: "2026-11",
  ownOnly: false,
  orders: 30,
  delivered: 21,
  deliveredShare: 70,
  paid: "1450.00",
  counts: counts(9, 14, 7),
  months: [
    { month: "2026-10", counts: counts(5, 8, 3), paid: "800.00" },
    { month: "2026-11", counts: counts(4, 6, 4), paid: "650.00" },
  ],
  byLocation: [{ key: "k", label: "Київ", delivered: 18, orders: 25, paid: "1450.00" }],
  byClient: [{ key: "c1", label: "ДСВ Логістика", delivered: 9, orders: 11, paid: "600.00" }],
  byManager: [{ key: "u1", label: "Марія Менеджер", delivered: 21, orders: 30, paid: "1450.00" }],
};

/** Аналітика з вигаданими даними для каталогу `/ui-kit`. */
export default function AnalyticsPreview({
  tab,
  ownOnly,
}: {
  tab: AnalyticsTab;
  ownOnly: boolean;
}) {
  return (
    <AnalyticsShell tab={tab} from="2026-07" to="2026-11">
      {tab === "boxes" ? (
        <BoxesContent data={{ ...BOXES, ownOnly }} />
      ) : tab === "delivery" ? (
        <DeliveryContent data={{ ...DELIVERY, ownOnly }} />
      ) : (
        <AnalyticsContent data={{ ...DATA, ownOnly }} />
      )}
    </AnalyticsShell>
  );
}
