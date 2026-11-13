"use client";

import { useState } from "react";
import {
  DAY_PRESET_LABELS,
  DAY_PRESETS,
  type DayPreset,
  ORDER_LIST_PARAMS,
} from "@/utils/orderListParams";
import Chip from "../shared/chips/Chip";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Disclosure from "../shared/disclosure/Disclosure";
import { useUrlParams } from "../shared/search/useUrlParams";

interface DayChipsProps {
  /** Вибраний день, або «range» (дати вказано вручну). */
  day: DayPreset | "range";
  dateFrom: string;
  dateTo: string;
}

/**
 * Дні замовлень: плашки «Вчора», «Сьогодні», «Завтра», «Тиждень» і блок «Інший період» з двома
 * датами. Вибір пишеться в адресу сторінки (`?day=`, `?from=&to=`), тож стан не губиться.
 */
export default function DayChips({ day, dateFrom, dateTo }: DayChipsProps) {
  const { params, update } = useUrlParams();
  // Показуємо те, що вибрано щойно (до відповіді сервера), а не те, з чим прийшла сторінка.
  // Без параметра `day` це «Сьогодні».
  const hasRange = params.has(ORDER_LIST_PARAMS.from) || params.has(ORDER_LIST_PARAMS.to);
  const requested = params.get(ORDER_LIST_PARAMS.day) ?? "today";
  const current: DayPreset | "range" = hasRange
    ? "range"
    : (DAY_PRESETS.find((preset) => preset === requested) ?? "today");
  const [isRangeOpen, setIsRangeOpen] = useState(day === "range");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="День замовлень">
        {DAY_PRESETS.map((preset) => (
          <Chip
            key={preset}
            selected={current === preset}
            onClick={() => {
              setIsRangeOpen(false);
              update({
                [ORDER_LIST_PARAMS.day]: preset === "today" ? null : preset,
                [ORDER_LIST_PARAMS.from]: null,
                [ORDER_LIST_PARAMS.to]: null,
              });
            }}
          >
            {DAY_PRESET_LABELS[preset]}
          </Chip>
        ))}
        <Chip selected={current === "range"} onClick={() => setIsRangeOpen((open) => !open)}>
          Інший період
        </Chip>
      </div>
      {isRangeOpen || current === "range" ? (
        <Disclosure summary="Діапазон дат" defaultOpen>
          <div className="grid gap-4 sm:grid-cols-2">
            <CustomizedInput
              name="from"
              type="date"
              label="Від"
              defaultValue={dateFrom}
              onChange={(event) =>
                update({
                  [ORDER_LIST_PARAMS.from]: event.target.value,
                  [ORDER_LIST_PARAMS.day]: null,
                })
              }
            />
            <CustomizedInput
              name="to"
              type="date"
              label="До"
              defaultValue={dateTo}
              onChange={(event) =>
                update({
                  [ORDER_LIST_PARAMS.to]: event.target.value,
                  [ORDER_LIST_PARAMS.day]: null,
                })
              }
            />
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
