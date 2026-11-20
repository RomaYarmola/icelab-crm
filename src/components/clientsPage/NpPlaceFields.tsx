"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { NpCityOption, NpWarehouseOption } from "@/server/np/addresses";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Text from "../shared/texts/Text";
import type { NpPickerActions } from "./clientActions";

export interface NpPlaceValue {
  cityText: string;
  cityRef: string;
  warehouseNumber: string;
  warehouseRef: string;
}

interface NpPlaceFieldsProps {
  /** `np_warehouse`: місто й відділення чи поштомат, `np_address`: лише місто (адресу вводять окремо). */
  withWarehouse: boolean;
  defaults: NpPlaceValue;
  actions: Pick<NpPickerActions, "searchCities" | "searchWarehouses">;
  /** Повідомляє, чи вибір повний (місто й, за потреби, відділення з довідника). */
  onComplete?: (complete: boolean) => void;
  /** Поточний вибір з назвами (для підписів у налаштуваннях відправника). */
  onSelect?: (selection: {
    cityRef: string;
    cityName: string;
    warehouseRef: string;
    warehouseName: string;
  }) => void;
}

const DEBOUNCE_MS = 250;

const optionClassName =
  "flex min-h-11 w-full flex-col items-start justify-center rounded-field border border-grey-field bg-white px-4 py-2 text-left text-body text-navy transition active:scale-[98%] lg:hover:bg-grey-light";

/**
 * Місто й відділення чи поштомат Нової Пошти з підказками (20.11.2026): пишете частину назви міста,
 * обираєте зі списку (довідник Нової Пошти, який ми оновлюємо щодоби); далі пишете номер відділення
 * чи поштомата, і підказки показують номери саме по цьому місту. Вибір іде в приховані поля, а
 * адреса зберігається одразу зіставленою з довідником.
 */
export default function NpPlaceFields({
  withWarehouse,
  defaults,
  actions,
  onComplete,
  onSelect,
}: NpPlaceFieldsProps) {
  const [isSearching, startSearch] = useTransition();
  const [cityText, setCityText] = useState(defaults.cityText);
  const [cityRef, setCityRef] = useState(defaults.cityRef);
  const [cities, setCities] = useState<NpCityOption[]>([]);
  const [warehouseText, setWarehouseText] = useState(defaults.warehouseNumber);
  const [warehouseRef, setWarehouseRef] = useState(defaults.warehouseRef);
  const [warehouseNumber, setWarehouseNumber] = useState(defaults.warehouseNumber);
  const [warehouses, setWarehouses] = useState<NpWarehouseOption[]>([]);
  const timer = useRef<number | null>(null);

  const complete = cityRef !== "" && (!withWarehouse || warehouseRef !== "");
  useEffect(() => {
    onComplete?.(complete);
  }, [complete, onComplete]);
  useEffect(() => {
    onSelect?.({ cityRef, cityName: cityText, warehouseRef, warehouseName: warehouseText });
  }, [cityRef, cityText, warehouseRef, warehouseText, onSelect]);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  function schedule(run: () => void) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => startSearch(run), DEBOUNCE_MS);
  }

  function onCityInput(value: string) {
    setCityText(value);
    // Текст змінили: попередній вибір з довідника більше не діє.
    setCityRef("");
    setWarehouseRef("");
    setWarehouseNumber("");
    setWarehouseText("");
    setWarehouses([]);
    schedule(async () => setCities(await actions.searchCities(value)));
  }

  function chooseCity(option: NpCityOption) {
    setCityText(option.name);
    setCityRef(option.ref);
    setCities([]);
    setWarehouseRef("");
    setWarehouseNumber("");
    setWarehouseText("");
    if (withWarehouse) {
      startSearch(async () => setWarehouses(await actions.searchWarehouses(option.ref, "")));
    }
  }

  function onWarehouseInput(value: string) {
    setWarehouseText(value);
    setWarehouseRef("");
    setWarehouseNumber("");
    if (!cityRef) return;
    schedule(async () => setWarehouses(await actions.searchWarehouses(cityRef, value)));
  }

  function chooseWarehouse(option: NpWarehouseOption) {
    setWarehouseText(option.name);
    setWarehouseRef(option.ref);
    setWarehouseNumber(option.number ?? "");
    setWarehouses([]);
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="npCityRef" value={cityRef} />
      <input type="hidden" name="npWarehouseRef" value={withWarehouse ? warehouseRef : ""} />
      <input type="hidden" name="npWarehouseNumber" value={withWarehouse ? warehouseNumber : ""} />

      <CustomizedInput
        name="cityText"
        label="Місто"
        autoComplete="off"
        value={cityText}
        onChange={(event) => onCityInput(event.target.value)}
        hint={
          cityRef
            ? "Місто з довідника Нової Пошти."
            : "Почніть вводити назву й оберіть місто зі списку підказок."
        }
        required
      />
      {cities.length > 0 && !cityRef ? (
        <ul className="flex flex-col gap-2" aria-label="Підказки міст">
          {cities.map((option) => (
            <li key={option.ref}>
              <button type="button" className={optionClassName} onClick={() => chooseCity(option)}>
                <span className="font-semibold">{option.name}</span>
                {option.area ? <span className="text-grey-text">{option.area} область</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : cityText.trim().length >= 2 && !cityRef && !isSearching ? (
        <Text variant="muted">
          Міста не знайдено. Перевірте назву; якщо довідник Нової Пошти порожній, власник оновлює
          його на екрані «Нова Пошта».
        </Text>
      ) : null}

      {withWarehouse ? (
        <>
          <CustomizedInput
            name=""
            label="Номер відділення або поштомата"
            autoComplete="off"
            value={warehouseText}
            disabled={!cityRef}
            onChange={(event) => onWarehouseInput(event.target.value)}
            hint={
              !cityRef
                ? "Спочатку оберіть місто."
                : warehouseRef
                  ? "Відділення чи поштомат з довідника Нової Пошти."
                  : "Введіть номер чи частину назви й оберіть зі списку підказок."
            }
            required
          />
          {cityRef && !warehouseRef ? (
            warehouses.length > 0 ? (
              <ul className="flex flex-col gap-2" aria-label="Підказки відділень і поштоматів">
                {warehouses.map((option) => (
                  <li key={option.ref}>
                    <button
                      type="button"
                      className={optionClassName}
                      onClick={() => chooseWarehouse(option)}
                    >
                      {option.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Text variant="muted">Відділень і поштоматів за цим запитом не знайдено.</Text>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
