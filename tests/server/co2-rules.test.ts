import { describe, expect, it } from "vitest";
import { buildCo2Ledger, normOn } from "@/server/finance/co2-rules";

const NORMS = [{ validFrom: "2026-01-01", normMilli: 2700 }];
const receipt = (date: string, kg: number, price: number) => ({
  date,
  grams: kg * 1000,
  kopecksPerKg: price * 100,
});
const ice = (date: string, kg: number, source: "orders" | "writeoff" = "orders") => ({
  date,
  iceGrams: kg * 1000,
  source,
});
const ledger = (input: Partial<Parameters<typeof buildCo2Ledger>[0]>) =>
  buildCo2Ledger({
    receipts: [],
    norms: NORMS,
    adjustments: [],
    uses: [],
    asOf: "2026-11-30",
    ...input,
  });

describe("списання CO2 (D232, D233)", () => {
  it("норма на дату: остання чинна, до першої діє найраніша", () => {
    const norms = [
      { validFrom: "2026-11-10", normMilli: 2500 },
      { validFrom: "2026-11-01", normMilli: 2700 },
    ];
    expect(normOn(norms, "2026-10-01")).toBe(2700);
    expect(normOn(norms, "2026-11-09")).toBe(2700);
    expect(normOn(norms, "2026-11-10")).toBe(2500);
    expect(normOn([], "2026-11-10")).toBeNull();
  });

  it("спершу найстаріша партія за її ціною, потім наступна", () => {
    const result = ledger({
      receipts: [receipt("2026-11-05", 100, 40), receipt("2026-11-01", 100, 30)],
      // 50 кг льоду = 135 кг CO2: 100 по 30 і 35 по 40.
      uses: [ice("2026-11-06", 50)],
    });
    expect(result.months[0]!.orders).toEqual({
      iceGrams: 50_000,
      co2Grams: 135_000,
      costKopecks: 440_000,
    });
    expect(result).toMatchObject({ stockGrams: 65_000, stockKopecks: 260_000, shortageGrams: 0 });
  });

  it("нестача рахується за останньою ціною й не переходить на наступний прихід", () => {
    const result = ledger({
      receipts: [receipt("2026-11-01", 100, 30), receipt("2026-11-20", 500, 50)],
      uses: [ice("2026-11-02", 50)],
    });
    expect(result.months[0]).toMatchObject({ shortageGrams: 35_000 });
    expect(result.months[0]!.orders.costKopecks).toBe(135 * 3000);
    expect(result.stockGrams).toBe(500_000);
    expect(result.shortageGrams).toBe(35_000);
  });

  it("лід до першого приходу й після дати розрахунку не враховується; без приходів обліку немає", () => {
    const result = ledger({
      receipts: [receipt("2026-11-10", 1000, 30)],
      uses: [ice("2026-11-09", 100), ice("2026-11-10", 10), ice("2026-12-01", 100)],
    });
    expect(result.startedOn).toBe("2026-11-10");
    expect(result.stockGrams).toBe(973_000);
    expect(ledger({ uses: [ice("2026-11-10", 10)] })).toMatchObject({
      startedOn: null,
      months: [],
      stockGrams: 0,
    });
  });

  it("списаний лід окремо; виправлення діє на кінець дня", () => {
    const result = ledger({
      receipts: [receipt("2026-11-01", 1000, 30)],
      uses: [ice("2026-11-02", 10, "writeoff"), ice("2026-11-02", 20)],
      adjustments: [{ date: "2026-11-02", grams: -19_000 }],
    });
    expect(result.months[0]!.writeoffs.co2Grams).toBe(27_000);
    expect(result.months[0]!.orders.co2Grams).toBe(54_000);
    expect(result.stockGrams).toBe(900_000);
  });

  it("додатне виправлення додає CO2 за останньою ціною", () => {
    const result = ledger({
      receipts: [receipt("2026-11-01", 10, 30)],
      adjustments: [{ date: "2026-11-03", grams: 5_000 }],
    });
    expect(result).toMatchObject({ stockGrams: 15_000, stockKopecks: 45_000 });
  });

  it("нова норма діє з її дати; без норми CO2 не рахується й про це відомо", () => {
    const result = ledger({
      receipts: [receipt("2026-10-01", 1000, 30)],
      norms: [...NORMS, { validFrom: "2026-11-01", normMilli: 2000 }],
      uses: [ice("2026-10-31", 10), ice("2026-11-01", 10)],
    });
    expect(result.months.map((m) => m.orders.co2Grams)).toEqual([27_000, 20_000]);
    expect(
      ledger({
        receipts: [receipt("2026-11-01", 10, 30)],
        norms: [],
        uses: [ice("2026-11-02", 1)],
      }),
    ).toMatchObject({ missingNorm: true, stockGrams: 10_000 });
  });
});
