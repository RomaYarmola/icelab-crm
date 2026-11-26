import type { Co2PageData } from "@/server/finance/co2";
import type { FormAction } from "../clientsPage/clientActions";
import FinancePageContent from "../financePage/FinancePageContent";

const DATA: Co2PageData = {
  locations: [
    { id: "preview-kyiv", code: "kyiv", name: "Київ" },
    { id: "preview-lviv", code: "lviv", name: "Львів" },
  ],
  location: { id: "preview-kyiv", code: "kyiv", name: "Київ" },
  today: "2026-11-26",
  startedOn: "2026-11-01",
  stockKg: 1240.5,
  stockValue: "37215.00",
  norm: 2.7,
  shortageKg: 135,
  missingNorm: false,
  months: [
    {
      month: "2026-11",
      orders: { iceKg: 2100, co2Kg: 5670, cost: "161595.00" },
      writeoffs: { iceKg: 24, co2Kg: 64.8, cost: "1944.00" },
      shortageKg: 135,
    },
  ],
  receipts: [
    { id: "r2", date: "2026-11-18", kg: 4000, pricePerKg: "30.00", note: "Друга поставка" },
    { id: "r1", date: "2026-11-01", kg: 3000, pricePerKg: "27.00", note: null },
  ],
  adjustments: [{ id: "a1", date: "2026-11-20", kg: -35, note: "Звірили за вагами" }],
  writeoffs: [{ id: "w1", date: "2026-11-21", kg: 8, note: "Залишок за тиждень" }],
  norms: [{ id: "n1", validFrom: "2026-01-01", norm: 2.7 }],
};

/** Екран «Фінрезультат» з вигаданими даними (лише для `/ui-kit`). */
export default function FinancePreview({ formAction }: { formAction: FormAction }) {
  return (
    <FinancePageContent
      data={DATA}
      actions={{
        addReceipt: formAction,
        addWriteoff: formAction,
        setStock: formAction,
        setNorm: formAction,
        deleteReceipt: formAction,
        deleteWriteoff: formAction,
        deleteAdjustment: formAction,
        deleteNorm: formAction,
      }}
    />
  );
}
