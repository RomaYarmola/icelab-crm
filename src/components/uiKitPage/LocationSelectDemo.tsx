"use client";

import LocationSelect from "../shared/header/LocationSelect";

const OPTIONS = [
  { id: "kyiv", name: "Київ" },
  { id: "lviv", name: "Львів" },
];

/** Демонстрація вибору локації з шапки: збереження вдає успіх, cookie в каталозі не пишеться. */
export default function LocationSelectDemo() {
  return (
    <LocationSelect
      options={OPTIONS}
      selectedId={null}
      allLabel="Усі локації"
      action={async () => ({ ok: true })}
    />
  );
}
