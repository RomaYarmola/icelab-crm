/**
 * Списання сировини CO2 (B15, D232, D233, D240). Чисті функції без бази: з приходів, норм,
 * виправлень і виробленого льоду рахуємо залишок і вартість CO2.
 *
 * Правила: спершу найстаріша партія (за її ціною), потім наступна. Якщо внесеного CO2 не вистачає,
 * решту рахуємо за останньою ціною й показуємо нестачу; у борг наступним партіям вона не
 * переходить. Облік міста починається з дати першого приходу: раніший лід не рахується.
 *
 * Одиниці: грами, копійки за кг, норма в тисячних (2,7 кг/кг це 2700), щоб не накопичувати похибку.
 */

export type Co2Receipt = { date: string; grams: number; kopecksPerKg: number };
export type Co2Norm = { validFrom: string; normMilli: number };
/** Виправлення залишку: додатне додає CO2, від'ємне прибирає. */
export type Co2Adjustment = { date: string; grams: number };
/** Лід за день: з замовлень («виготовити») чи списаний. */
export type IceUse = { date: string; iceGrams: number; source: "orders" | "writeoff" };

export type Co2UseTotals = { iceGrams: number; co2Grams: number; costKopecks: number };

export type Co2Month = {
  month: string;
  orders: Co2UseTotals;
  writeoffs: Co2UseTotals;
  /** CO2, якого не вистачило серед внесених приходів. */
  shortageGrams: number;
};

export type Co2Ledger = {
  /** Дата першого приходу; `null`: приходів ще немає, нічого не рахуємо. */
  startedOn: string | null;
  stockGrams: number;
  stockKopecks: number;
  months: Co2Month[];
  shortageGrams: number;
  /** Лід є, а норми немає: CO2 порахувати нема за чим. */
  missingNorm: boolean;
};

/** Норма на дату: остання, що вже діє; до першої норми діє найраніша. */
export function normOn(norms: Co2Norm[], date: string): number | null {
  let current: Co2Norm | null = null;
  let earliest: Co2Norm | null = null;
  for (const norm of norms) {
    if (!earliest || norm.validFrom < earliest.validFrom) earliest = norm;
    if (norm.validFrom <= date && (!current || norm.validFrom > current.validFrom)) current = norm;
  }
  return (current ?? earliest)?.normMilli ?? null;
}

type Event =
  | { date: string; step: 0; receipt: Co2Receipt }
  | { date: string; step: 1; use: IceUse }
  | { date: string; step: 2; adjustment: Co2Adjustment };

const emptyTotals = (): Co2UseTotals => ({ iceGrams: 0, co2Grams: 0, costKopecks: 0 });

/** Рахує облік CO2 одного міста станом на `asOf` (пізніші дати не враховуються). */
export function buildCo2Ledger(input: {
  receipts: Co2Receipt[];
  norms: Co2Norm[];
  adjustments: Co2Adjustment[];
  uses: IceUse[];
  asOf: string;
}): Co2Ledger {
  const receipts = input.receipts.filter((r) => r.date <= input.asOf);
  const startedOn = receipts.reduce<string | null>(
    (min, r) => (min === null || r.date < min ? r.date : min),
    null,
  );
  const ledger: Co2Ledger = {
    startedOn,
    stockGrams: 0,
    stockKopecks: 0,
    months: [],
    shortageGrams: 0,
    missingNorm: false,
  };
  if (startedOn === null) return ledger;

  const inRange = (date: string) => date >= startedOn && date <= input.asOf;
  // У межах дня: спершу приходи, потім лід, насамкінець виправлення (воно про залишок на кінець дня).
  const events: Event[] = [
    ...receipts.map((receipt) => ({ date: receipt.date, step: 0 as const, receipt })),
    ...input.uses
      .filter((use) => inRange(use.date))
      .map((use) => ({ date: use.date, step: 1 as const, use })),
    ...input.adjustments
      .filter((a) => inRange(a.date))
      .map((adjustment) => ({ date: adjustment.date, step: 2 as const, adjustment })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.step - b.step);

  const batches: { grams: number; kopecksPerKg: number }[] = [];
  let lastPrice = 0;
  const months = new Map<string, Co2Month>();

  /** Забирає CO2 з найстаріших партій; повертає вартість і те, чого не вистачило. */
  const take = (grams: number) => {
    let left = grams;
    let cost = 0;
    while (left > 0 && batches.length > 0) {
      const batch = batches[0]!;
      const part = Math.min(left, batch.grams);
      cost += (part * batch.kopecksPerKg) / 1000;
      batch.grams -= part;
      left -= part;
      if (batch.grams === 0) batches.shift();
    }
    return { cost, missing: left };
  };

  for (const event of events) {
    if (event.step === 0) {
      lastPrice = event.receipt.kopecksPerKg;
      batches.push({ grams: event.receipt.grams, kopecksPerKg: lastPrice });
    } else if (event.step === 2) {
      const { grams } = event.adjustment;
      if (grams > 0) batches.push({ grams, kopecksPerKg: lastPrice });
      else take(-grams);
    } else {
      const normMilli = normOn(input.norms, event.date);
      if (normMilli === null) {
        ledger.missingNorm = true;
        continue;
      }
      const need = Math.round((event.use.iceGrams * normMilli) / 1000);
      const { cost, missing } = take(need);
      const key = event.date.slice(0, 7);
      const month = months.get(key) ?? {
        month: key,
        orders: emptyTotals(),
        writeoffs: emptyTotals(),
        shortageGrams: 0,
      };
      months.set(key, month);
      const totals = event.use.source === "orders" ? month.orders : month.writeoffs;
      totals.iceGrams += event.use.iceGrams;
      totals.co2Grams += need;
      totals.costKopecks += cost + (missing * lastPrice) / 1000;
      month.shortageGrams += missing;
      ledger.shortageGrams += missing;
    }
  }

  ledger.stockGrams = batches.reduce((sum, b) => sum + b.grams, 0);
  ledger.stockKopecks = Math.round(
    batches.reduce((sum, b) => sum + (b.grams * b.kopecksPerKg) / 1000, 0),
  );
  ledger.months = [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((month) => ({
      ...month,
      orders: { ...month.orders, costKopecks: Math.round(month.orders.costKopecks) },
      writeoffs: { ...month.writeoffs, costKopecks: Math.round(month.writeoffs.costKopecks) },
    }));
  return ledger;
}
