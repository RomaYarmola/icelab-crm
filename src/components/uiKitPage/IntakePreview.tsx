import IntakeContent from "../intakePage/IntakeContent";
import type { IntakeActions } from "../intakePage/intakeTypes";

interface IntakePreviewProps {
  formAction: IntakeActions["check"];
}

/** Екран «Прийом заявок» з вигаданими даними для каталогу `/ui-kit`. */
export default function IntakePreview({ formAction }: IntakePreviewProps) {
  return (
    <IntakeContent
      actions={{
        check: formAction,
        connect: formAction,
        startCapture: formAction,
        cancelCapture: formAction,
        createCode: formAction,
        unlink: formAction,
        setConfirmer: formAction,
      }}
      status={{
        hasToken: true,
        hasWebhookSecret: true,
        settings: {
          groupChatId: -1001111111111,
          topicKyiv: 11,
          topicLviv: null,
          ownerChatId: null,
          capture: null,
          botUsername: "icelab_bot",
        },
        users: [
          {
            id: "u1",
            fullName: "Олена Коваль",
            role: "owner",
            locationName: null,
            isLinked: true,
            isConfirmer: true,
          },
          {
            id: "u2",
            fullName: "Марія Менеджер",
            role: "manager",
            locationName: null,
            isLinked: false,
            isConfirmer: false,
          },
          {
            id: "u3",
            fullName: "Андрій Менеджер",
            role: "manager",
            locationName: null,
            isLinked: true,
            isConfirmer: true,
          },
        ],
        anyoneConfirms: false,
      }}
    />
  );
}
