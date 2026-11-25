"use client";

import { ANALYTICS_PARAMS } from "@/utils/analyticsParams";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import { useUrlParams } from "../shared/search/useUrlParams";

/** Період панелі: два місяці в адресі сторінки. Локацію обирають у шапці. */
export default function AnalyticsFilters({ from, to }: { from: string; to: string }) {
  const { update } = useUrlParams();
  return (
    <div className="grid max-w-xl gap-4 sm:grid-cols-2">
      <CustomizedInput
        name="from"
        type="month"
        label="З місяця"
        defaultValue={from}
        onChange={(event) => update({ [ANALYTICS_PARAMS.from]: event.target.value })}
      />
      <CustomizedInput
        name="to"
        type="month"
        label="По місяць"
        defaultValue={to}
        onChange={(event) => update({ [ANALYTICS_PARAMS.to]: event.target.value })}
      />
    </div>
  );
}
