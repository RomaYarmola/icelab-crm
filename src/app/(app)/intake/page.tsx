import type { Metadata } from "next";
import IntakeContent from "@/components/intakePage/IntakeContent";
import { getDb } from "@/db/client";
import { getIntakeStatus } from "@/server/telegram/admin";
import { requirePageUser } from "@/server/page-access";
import {
  cancelCaptureAction,
  checkTelegramAction,
  connectWebhookAction,
  createCodeAction,
  setConfirmerAction,
  startCaptureAction,
  unlinkAction,
} from "./actions";

export const metadata: Metadata = { title: "Прийом заявок" };

/** Налаштування приймання заявок з Telegram: бот, група й топіки, прив'язка користувачів. Лише власник. */
export default async function IntakePage() {
  const user = await requirePageUser("intake");
  const status = await getIntakeStatus(getDb(), user);
  return (
    <IntakeContent
      status={status}
      actions={{
        check: checkTelegramAction,
        connect: connectWebhookAction,
        startCapture: startCaptureAction,
        cancelCapture: cancelCaptureAction,
        createCode: createCodeAction,
        unlink: unlinkAction,
        setConfirmer: setConfirmerAction,
      }}
    />
  );
}
