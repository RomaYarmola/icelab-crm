import type { Metadata } from "next";
import NpSettingsContent from "@/components/npPage/NpSettingsContent";
import { getDb } from "@/db/client";
import { getNpSettings } from "@/server/np/settings";
import { requirePageUser } from "@/server/page-access";
import {
  checkConnectionAction,
  loadSenderDetailsAction,
  loadSendersAction,
  saveEmptyWeightAction,
  saveSenderAction,
} from "./actions";

export const metadata: Metadata = { title: "Нова Пошта" };

/** Налаштування Нової Пошти: ключ, відправник кожної локації, вага порожніх боксів. Лише власник. */
export default async function NpPage() {
  const user = await requirePageUser("np");
  const view = await getNpSettings(getDb(), user);
  return (
    <NpSettingsContent
      view={view}
      actions={{
        check: checkConnectionAction,
        loadSenders: loadSendersAction,
        loadSenderDetails: loadSenderDetailsAction,
        saveSender: saveSenderAction,
        saveWeight: saveEmptyWeightAction,
      }}
    />
  );
}
