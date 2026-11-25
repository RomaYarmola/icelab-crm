import type { Analytics } from "@/server/analytics";
import AnalyticsContent from "../analyticsPage/AnalyticsContent";

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

/** Панель «Аналітика» з вигаданими даними для каталогу `/ui-kit`. */
export default function AnalyticsPreview({ ownOnly }: { ownOnly: boolean }) {
  return <AnalyticsContent data={{ ...DATA, ownOnly }} />;
}
