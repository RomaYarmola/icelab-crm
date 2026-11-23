import { ROLE_LABELS } from "@/server/permissions";
import type { IntakeStatus } from "@/server/telegram/admin";
import { isCaptureActive } from "@/server/telegram/settings";
import { formatDateTime } from "@/utils/formatDate";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import ActionForm from "./ActionForm";
import type { IntakeActions } from "./intakeTypes";

interface IntakeContentProps {
  status: IntakeStatus;
  actions: IntakeActions;
}

/**
 * Екран «Прийом заявок» (B11, ТЗ 6.12): чи налаштований бот, підключення до цієї адреси, група й топіки
 * Київ і Львів, прив'язка менеджерів до Telegram. Токен і секрет не показуються, лише «є» чи «немає».
 */
export default function IntakeContent({ status, actions }: IntakeContentProps) {
  const { settings } = status;
  const capturing = isCaptureActive(settings.capture);
  const topics = [
    { target: "kyiv", label: "Київ", id: settings.topicKyiv },
    { target: "lviv", label: "Львів", id: settings.topicLviv },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="intake-bot" className="flex max-w-xl flex-col gap-3">
        <SectionTitle id="intake-bot">Бот</SectionTitle>
        {status.hasToken && status.hasWebhookSecret ? (
          <Notification variant="success">Токен бота й секрет webhook налаштовано.</Notification>
        ) : (
          <Notification variant="warning" title="Бот не налаштований">
            Додайте у змінні середовища сервера токен бота (TELEGRAM_BOT_TOKEN) і секрет webhook
            (TELEGRAM_WEBHOOK_SECRET) та перезапустіть застосунок. На екрані вони не показуються.
          </Notification>
        )}
        <Text variant="muted">
          Бот читає групу «Замовлення» та складає з повідомлень чернетки замовлень. Щоб Telegram
          почав надсилати події, підключіть бота до цієї адреси застосунку.
        </Text>
        <ActionForm
          action={actions.check}
          label="Перевірити з’єднання"
          loadingText="Перевіряємо…"
          disabled={!status.hasToken}
        />
        <ActionForm
          action={actions.connect}
          label="Підключити бота до цієї адреси"
          loadingText="Підключаємо…"
          disabled={!status.hasToken || !status.hasWebhookSecret}
        />
      </section>

      <section aria-labelledby="intake-topics" className="flex flex-col gap-3">
        <SectionTitle id="intake-topics">Група й топіки</SectionTitle>
        <Text variant="muted" className="max-w-xl">
          Бот приймає заявки лише з топіків «Київ» і «Львів» своєї групи. Щоб їх визначити,
          натисніть кнопку нижче й напишіть будь-яке повідомлення в потрібному топіку (з вашого
          підключеного Telegram).
        </Text>
        {capturing ? (
          <Notification variant="info">
            Чекаємо повідомлення в топіку «{settings.capture!.target === "kyiv" ? "Київ" : "Львів"}»
            до {formatDateTime(new Date(settings.capture!.expiresAt))}.
            <div className="mt-3 max-w-xs">
              <ActionForm
                action={actions.cancelCapture}
                label="Скасувати"
                loadingText="Скасовуємо…"
              />
            </div>
          </Notification>
        ) : null}
        <ul className="grid gap-4 lg:grid-cols-2">
          {topics.map((topic) => (
            <Card as="li" key={topic.target} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <SubTitle>Топік «{topic.label}»</SubTitle>
                <Tag className="shrink-0">{topic.id !== null ? "Визначено" : "Не визначено"}</Tag>
              </div>
              <ActionForm
                action={actions.startCapture}
                fields={{ target: topic.target }}
                label={topic.id !== null ? "Визначити заново" : "Визначити топік"}
                loadingText="Зачекайте…"
                disabled={!status.hasToken}
              />
            </Card>
          ))}
        </ul>
        <Text variant="muted">
          {settings.groupChatId !== null ? "Група запам’ятована." : "Групу ще не визначено."}
        </Text>
      </section>

      <section aria-labelledby="intake-users" className="flex flex-col gap-3">
        <SectionTitle id="intake-users">Підключення користувачів</SectionTitle>
        <Text variant="muted" className="max-w-xl">
          Заявки приймаємо лише від підключених менеджерів і власника. Водіям підключення потрібне,
          щоб бачити свої доставки в боті. Створіть код, користувач надсилає його боту в Telegram:
          /start КОД.
        </Text>
        <Text variant="muted" className="max-w-xl">
          {status.anyoneConfirms
            ? "Підтверджувати заявки зараз може кожен менеджер і власник. Щоб обмежити, позначте потрібних людей кнопкою «Може підтверджувати заявки»."
            : "Підтверджувати заявки можуть лише позначені люди. Відхиляти й виправляти чернетки можуть усі."}
        </Text>
        <ul className="grid gap-4 lg:grid-cols-2">
          {status.users.map((user) => (
            <Card as="li" key={user.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SubTitle className="break-words">{user.fullName}</SubTitle>
                  <Text variant="muted">
                    {ROLE_LABELS[user.role]}
                    {user.locationName ? ` · ${user.locationName}` : ""}
                  </Text>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Tag>{user.isLinked ? "Підключено" : "Не підключено"}</Tag>
                  {user.isConfirmer ? <Tag>Підтверджує заявки</Tag> : null}
                </div>
              </div>
              <ActionForm
                action={actions.createCode}
                fields={{ profileId: user.id }}
                label={user.isLinked ? "Підключити заново (новий код)" : "Створити код"}
                loadingText="Створюємо…"
                disabled={!status.hasToken}
              />
              {user.role === "driver" ? null : (
                <ActionForm
                  action={actions.setConfirmer}
                  fields={{ profileId: user.id, allowed: user.isConfirmer ? "no" : "yes" }}
                  label={
                    user.isConfirmer ? "Забрати право підтверджувати" : "Може підтверджувати заявки"
                  }
                  loadingText="Зачекайте…"
                />
              )}
              {user.isLinked ? (
                <ActionForm
                  action={actions.unlink}
                  fields={{ profileId: user.id }}
                  label="Відключити Telegram"
                  loadingText="Відключаємо…"
                />
              ) : null}
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
