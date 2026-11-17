import type { NpLoadResult } from "@/app/(app)/np/actions";
import type { NpSyncStep } from "@/app/(app)/np/actions";
import type { NpOption } from "@/server/np/settings";
import type { FormAction } from "../clientsPage/clientActions";

/** Дії екрана «Нова Пошта»: екран отримує їх готовими (у каталозі `/ui-kit` це заглушки). */
export interface NpActions {
  check: FormAction;
  loadSenders: () => Promise<NpLoadResult<NpOption[]>>;
  loadSenderDetails: (
    senderRef: string,
  ) => Promise<NpLoadResult<{ contacts: NpOption[]; addresses: NpOption[] }>>;
  saveSender: FormAction;
  saveWeight: FormAction;
  sync: () => Promise<NpSyncStep>;
  autoResolve: FormAction;
}
