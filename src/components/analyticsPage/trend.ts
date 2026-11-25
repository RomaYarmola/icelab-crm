import type { Metrics } from "@/server/analytics";
import { monthLabel } from "./monthLabel";

const previousOf = (month: string): string => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
};

/**
 * Динаміка до попереднього місяця словами (за гривнями): «+20 % до жовт. 2026 р.», «стільки ж»,
 * «у жовт. не замовляв».
 */
export function shiftMonthLabel(month: string, last: Metrics, previous: Metrics): string {
  const before = monthLabel(previousOf(month));
  const was = Number(previous.uah);
  const now = Number(last.uah);
  if (was === 0 && now === 0) return `${before}: замовлень не було`;
  if (was === 0) return `нове проти ${before}`;
  const percent = Math.round(((now - was) / was) * 100);
  if (percent === 0) return `стільки ж, як у ${before}`;
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)} % до ${before}`;
}
