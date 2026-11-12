"use client";

import { CLIENT_LIST_PARAMS } from "@/utils/clientListParams";
import Chip from "../shared/chips/Chip";
import { useUrlParam } from "../shared/search/useUrlParam";

/** Власник вмикає показ видалених клієнтів (стан в адресі, як і решта фільтрів). */
export default function DeletedToggle() {
  const { value, push } = useUrlParam(CLIENT_LIST_PARAMS.deleted);
  const isOn = value === "1";

  return (
    <Chip selected={isOn} onClick={() => push(isOn ? "" : "1")} className="w-fit">
      Показати видалених
    </Chip>
  );
}
