import type { NpCityOption, NpWarehouseOption } from "@/server/np/addresses";
import type { SimilarClient } from "@/server/clients";
import type { FormState } from "@/utils/formState";

/** Серверна дія форми: екран отримує її готовою (у каталозі `/ui-kit` це заглушка). */
export type FormAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Усі дії картки клієнта. Збираються на сторінці з `app/(app)/clients/actions`. */
export interface ClientCardActions {
  update: FormAction;
  assignRegion: FormAction;
  remove: FormAction;
  restore: FormAction;
  addContact: FormAction;
  updateContact: FormAction;
  deleteContact: FormAction;
  addAddress: FormAction;
  updateAddress: FormAction;
  deleteAddress: FormAction;
  addOwnBox: FormAction;
  updateOwnBox: FormAction;
  deleteOwnBox: FormAction;
  changePrice: FormAction;
  /** Підбір адреси в довідниках Нової Пошти (B10); немає там, де підбір не потрібен. */
  np?: NpPickerActions;
}

/** Дії підбору міста й відділення Нової Пошти для адреси клієнта. */
export interface NpPickerActions {
  searchCities: (query: string) => Promise<NpCityOption[]>;
  searchWarehouses: (cityRef: string, query: string) => Promise<NpWarehouseOption[]>;
  resolve: FormAction;
}

/** Дії форми «Новий клієнт»: створення і дві підказки (код за областю, схожі клієнти). */
export interface NewClientActions {
  create: FormAction;
  previewCode: (regionPrefix: string) => Promise<string | null>;
  findSimilar: (input: { name?: string; phone?: string }) => Promise<SimilarClient[]>;
}
