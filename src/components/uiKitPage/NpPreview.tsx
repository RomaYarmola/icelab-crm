import NpSettingsContent from "../npPage/NpSettingsContent";
import type { NpActions } from "../npPage/npTypes";

interface NpPreviewProps {
  formAction: NpActions["check"];
  loadSenders: NpActions["loadSenders"];
  loadSenderDetails: NpActions["loadSenderDetails"];
}

/** Екран «Нова Пошта» з вигаданими даними для каталогу `/ui-kit`. */
export default function NpPreview({ formAction, loadSenders, loadSenderDetails }: NpPreviewProps) {
  return (
    <NpSettingsContent
      actions={{
        check: formAction,
        loadSenders,
        loadSenderDetails,
        saveSender: formAction,
        saveWeight: formAction,
      }}
      view={{
        hasKey: true,
        lastCheck: {
          ok: true,
          at: "2026-11-17T09:30:00.000Z",
          message: "З’єднання працює. Відправників у вашому акаунті: 2.",
        },
        locations: [
          {
            locationId: "l1",
            code: "kyiv",
            name: "Київ",
            isConfigured: true,
            phone: "+380501234567",
            senderName: "ФОП Коваль О. І.",
            contactName: "Коваль Олена",
            addressName: "Київ, відділення № 5",
          },
          {
            locationId: "l2",
            code: "lviv",
            name: "Львів",
            isConfigured: false,
            phone: null,
            senderName: null,
            contactName: null,
            addressName: null,
          },
        ],
        boxTypes: [
          { id: "t1", name: "Наш довгий 46 л", emptyWeightKg: "2.500" },
          { id: "t2", name: "Наш малий 19 л", emptyWeightKg: null },
        ],
      }}
    />
  );
}
