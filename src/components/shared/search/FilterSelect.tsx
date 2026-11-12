"use client";

import CustomizedSelect, { type SelectOption } from "../customizedSelect/CustomizedSelect";
import { useUrlParam } from "./useUrlParam";

interface FilterSelectProps {
  /** Назва параметра адреси, де лежить вибране значення. */
  paramName: string;
  label: string;
  /** Підпис першого пункту («Усі статуси»): порожнє значення означає «без фільтра». */
  allLabel: string;
  options: SelectOption[];
}

/** Фільтр-список зі станом в адресі сторінки: вибір одразу оновлює список. */
export default function FilterSelect({ paramName, label, allLabel, options }: FilterSelectProps) {
  const { value, push } = useUrlParam(paramName);
  // Значення з адреси, якого немає в списку (старе посилання), показуємо як «усі».
  const known = options.some((option) => option.value === value) ? value : "";

  return (
    <CustomizedSelect
      name={paramName}
      label={label}
      options={[{ value: "", label: allLabel }, ...options]}
      value={known}
      onChange={(event) => push(event.target.value)}
    />
  );
}
