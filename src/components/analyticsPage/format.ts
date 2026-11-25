import { formatMoney } from "@/utils/formatNumber";
import { parseDecimal } from "@/utils/orderMath";

export const money = (value: string) => formatMoney(parseDecimal(value));
export const percent = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("uk-UA")} %`;
