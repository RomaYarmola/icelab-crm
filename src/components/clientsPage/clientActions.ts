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
  changePrice: FormAction;
}

/** Дії форми «Новий клієнт»: створення і дві підказки (код за областю, схожі клієнти). */
export interface NewClientActions {
  create: FormAction;
  previewCode: (regionPrefix: string) => Promise<string | null>;
  findSimilar: (input: { name?: string; phone?: string }) => Promise<SimilarClient[]>;
}
