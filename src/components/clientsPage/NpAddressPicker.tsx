"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { NpCityOption, NpWarehouseOption } from "@/server/np/addresses";
import { INITIAL_FORM_STATE } from "@/utils/formState";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import Form from "../shared/form/Form";
import FormMessage from "../shared/form/FormMessage";
import Text from "../shared/texts/Text";
import type { NpPickerActions } from "./clientActions";

interface NpAddressPickerProps {
  addressId: string;
  /** `np_warehouse` потребує ще й відділення, `np_address` лише міста. */
  kind: "np_warehouse" | "np_address";
  actions: NpPickerActions;
}

const DEBOUNCE_MS = 300;

const optionClassName =
  "flex min-h-11 w-full flex-col items-start justify-center rounded-field border border-grey-field bg-white px-4 py-2 text-left text-body text-navy transition active:scale-[98%] lg:hover:bg-grey-light";

/**
 * Підбір міста й відділення з довідника Нової Пошти (ТЗ 6.8): пишете частину назви, обираєте зі
 * списку, потім для складу номер чи назву відділення. Пошук іде в нашій копії довідника, тож
 * швидкий. Після збереження адреса «зіставлена» і з неї можна створювати накладну.
 */
export default function NpAddressPicker({ addressId, kind, actions }: NpAddressPickerProps) {
  const [state, formAction, isSaving] = useActionState(actions.resolve, INITIAL_FORM_STATE);
  const [isSearching, startSearch] = useTransition();
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<NpCityOption[]>([]);
  const [city, setCity] = useState<NpCityOption | null>(null);
  const [warehouseQuery, setWarehouseQuery] = useState("");
  const [warehouses, setWarehouses] = useState<NpWarehouseOption[]>([]);
  const [warehouse, setWarehouse] = useState<NpWarehouseOption | null>(null);
  const timer = useRef<number | null>(null);

  // Пошук із затримкою: не питаємо сервер на кожну літеру.
  function schedule(run: () => void) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => startSearch(run), DEBOUNCE_MS);
  }
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  function onCityQuery(value: string) {
    setCityQuery(value);
    schedule(async () => setCities(await actions.searchCities(value)));
  }

  function chooseCity(option: NpCityOption) {
    setCity(option);
    setCities([]);
    setWarehouse(null);
    setWarehouseQuery("");
    if (kind === "np_warehouse") {
      startSearch(async () => setWarehouses(await actions.searchWarehouses(option.ref, "")));
    }
  }

  function onWarehouseQuery(value: string) {
    setWarehouseQuery(value);
    if (!city) return;
    schedule(async () => setWarehouses(await actions.searchWarehouses(city.ref, value)));
  }

  const canSave = city !== null && (kind === "np_address" || warehouse !== null);

  return (
    <Form action={formAction}>
      <input type="hidden" name="id" value={addressId} />
      <input type="hidden" name="cityRef" value={city?.ref ?? ""} />
      <input type="hidden" name="warehouseRef" value={warehouse?.ref ?? ""} />

      {city ? (
        <div className="flex items-start justify-between gap-3 rounded-field bg-grey-light px-4 py-3">
          <div className="min-w-0">
            <Text variant="label">{city.name}</Text>
            {city.area ? <Text variant="muted">{city.area} область</Text> : null}
          </div>
          <MainButton
            variant="outline"
            size="sm"
            fullWidth={false}
            onClick={() => {
              setCity(null);
              setWarehouse(null);
              setWarehouses([]);
            }}
          >
            Змінити
          </MainButton>
        </div>
      ) : (
        <>
          <CustomizedInput
            name="cityQuery"
            label="Місто"
            autoComplete="off"
            value={cityQuery}
            onChange={(event) => onCityQuery(event.target.value)}
            hint="Почніть вводити назву, від двох літер."
          />
          {cities.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="Знайдені міста">
              {cities.map((option) => (
                <li key={option.ref}>
                  <button
                    type="button"
                    className={optionClassName}
                    onClick={() => chooseCity(option)}
                  >
                    <span className="font-semibold">{option.name}</span>
                    {option.area ? (
                      <span className="text-grey-text">{option.area} область</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : cityQuery.trim().length >= 2 && !isSearching ? (
            <Text variant="muted">Нічого не знайдено. Перевірте назву.</Text>
          ) : null}
        </>
      )}

      {city && kind === "np_warehouse" ? (
        warehouse ? (
          <div className="flex items-start justify-between gap-3 rounded-field bg-grey-light px-4 py-3">
            <Text variant="label" className="min-w-0 break-words">
              {warehouse.name}
            </Text>
            <MainButton
              variant="outline"
              size="sm"
              fullWidth={false}
              onClick={() => setWarehouse(null)}
            >
              Змінити
            </MainButton>
          </div>
        ) : (
          <>
            <CustomizedInput
              name="warehouseQuery"
              label="Відділення"
              autoComplete="off"
              value={warehouseQuery}
              onChange={(event) => onWarehouseQuery(event.target.value)}
              hint="Номер відділення чи частина назви."
            />
            {warehouses.length > 0 ? (
              <ul className="flex flex-col gap-2" aria-label="Знайдені відділення">
                {warehouses.map((option) => (
                  <li key={option.ref}>
                    <button
                      type="button"
                      className={optionClassName}
                      onClick={() => setWarehouse(option)}
                    >
                      {option.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : !isSearching ? (
              <Text variant="muted">Відділень не знайдено.</Text>
            ) : null}
          </>
        )
      ) : null}

      <FormMessage state={state} />
      <MainButton type="submit" disabled={!canSave} isLoading={isSaving} loadingText="Зберігаємо…">
        Зіставити з Новою Поштою
      </MainButton>
    </Form>
  );
}
