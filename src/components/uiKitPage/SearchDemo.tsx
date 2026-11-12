"use client";

import { Suspense, useState } from "react";
import LoadMoreButton from "../shared/buttons/LoadMoreButton";
import FilterSelect from "../shared/search/FilterSelect";
import SearchField from "../shared/search/SearchField";
import Text from "../shared/texts/Text";

/**
 * Демонстрація пошуку, фільтра й кнопки «Показати ще». Пошук і фільтр пишуть стан в адресу
 * сторінки (`?q=…`, `?demo-status=…`), тож перевірити їх можна, дивлячись на адресу.
 */
export default function SearchDemo() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="flex max-w-sm flex-col gap-4">
      <Suspense>
        <SearchField label="Пошук" placeholder="Код, назва, телефон або контакт" />
        <FilterSelect
          paramName="demo-status"
          label="Статус"
          allLabel="Усі статуси"
          options={[
            { value: "active", label: "Активний" },
            { value: "paused", label: "Пауза" },
          ]}
        />
      </Suspense>
      <Text variant="muted">
        Пошук запускається через 300 мс після останньої літери або за Enter, стан лежить в адресі
        сторінки.
      </Text>
      <LoadMoreButton
        isLoading={isLoading}
        onClick={() => {
          setIsLoading(true);
          setTimeout(() => setIsLoading(false), 1200);
        }}
      />
    </div>
  );
}
