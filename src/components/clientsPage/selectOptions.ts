import type { SelectOption } from "../shared/customizedSelect/CustomizedSelect";

/** Довідник `{ id, name }` у пункти списку вибору; `blankLabel` додає першим пункт «не вказано». */
export function toSelectOptions(
  list: { id: string; name: string }[],
  blankLabel?: string,
): SelectOption[] {
  const options = list.map((item) => ({ value: item.id, label: item.name }));
  return blankLabel === undefined ? options : [{ value: "", label: blankLabel }, ...options];
}
