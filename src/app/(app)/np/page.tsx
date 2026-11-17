import type { Metadata } from "next";
import NpSettingsContent from "@/components/npPage/NpSettingsContent";
import { getDb } from "@/db/client";
import { listUnresolvedAddresses } from "@/server/np/addresses";
import { getSyncStatus } from "@/server/np/directories";
import { getNpSettings } from "@/server/np/settings";
import { requirePageUser } from "@/server/page-access";
import {
  autoResolveAction,
  checkConnectionAction,
  loadSenderDetailsAction,
  loadSendersAction,
  saveEmptyWeightAction,
  saveSenderAction,
  syncDirectoriesAction,
} from "./actions";

export const metadata: Metadata = { title: "Нова Пошта" };

/** Налаштування Нової Пошти: ключ, відправник кожної локації, вага порожніх боксів. Лише власник. */
export default async function NpPage() {
  const user = await requirePageUser("np");
  const db = getDb();
  const [view, sync, unresolved] = await Promise.all([
    getNpSettings(db, user),
    getSyncStatus(db),
    listUnresolvedAddresses(db, user),
  ]);
  return (
    <NpSettingsContent
      view={view}
      sync={sync}
      unresolved={unresolved}
      actions={{
        check: checkConnectionAction,
        loadSenders: loadSendersAction,
        loadSenderDetails: loadSenderDetailsAction,
        saveSender: saveSenderAction,
        saveWeight: saveEmptyWeightAction,
        sync: syncDirectoriesAction,
        autoResolve: autoResolveAction,
      }}
    />
  );
}
