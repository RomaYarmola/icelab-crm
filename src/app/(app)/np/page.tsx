import type { Metadata } from "next";
import NpSettingsContent from "@/components/npPage/NpSettingsContent";
import { getDb } from "@/db/client";
import { listUnresolvedAddresses } from "@/server/np/addresses";
import { getTrackingStatus } from "@/server/np/tracking";
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
  trackAllAction,
} from "./actions";

export const metadata: Metadata = { title: "Нова Пошта" };

/** Налаштування Нової Пошти: ключ, відправник кожної локації, вага порожніх боксів. Лише власник. */
export default async function NpPage() {
  const user = await requirePageUser("np");
  const db = getDb();
  const [view, sync, unresolved, tracking] = await Promise.all([
    getNpSettings(db, user),
    getSyncStatus(db),
    listUnresolvedAddresses(db, user),
    getTrackingStatus(db),
  ]);
  return (
    <NpSettingsContent
      view={view}
      sync={sync}
      unresolved={unresolved}
      tracking={tracking}
      actions={{
        check: checkConnectionAction,
        loadSenders: loadSendersAction,
        loadSenderDetails: loadSenderDetailsAction,
        saveSender: saveSenderAction,
        saveWeight: saveEmptyWeightAction,
        sync: syncDirectoriesAction,
        autoResolve: autoResolveAction,
        trackAll: trackAllAction,
      }}
    />
  );
}
