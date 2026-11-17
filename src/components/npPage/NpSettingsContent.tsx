import { formatDateTime } from "@/utils/formatDate";
import type { UnresolvedAddress } from "@/server/np/addresses";
import type { SyncStatus } from "@/server/np/directories";
import type { TrackingStatus } from "@/server/np/tracking";
import type { NpSettingsView } from "@/server/np/settings";
import Card from "../shared/cards/Card";
import Disclosure from "../shared/disclosure/Disclosure";
import Notification from "../shared/notification/Notification";
import Tag from "../shared/chips/Tag";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";
import Link from "next/link";
import AutoResolve from "./AutoResolve";
import ConnectionCheck from "./ConnectionCheck";
import DirectorySync from "./DirectorySync";
import EmptyWeightForm from "./EmptyWeightForm";
import type { NpActions } from "./npTypes";
import SenderForm from "./SenderForm";
import TrackAll from "./TrackAll";

interface NpSettingsContentProps {
  view: NpSettingsView;
  sync: SyncStatus;
  unresolved: { total: number; items: UnresolvedAddress[] };
  tracking: TrackingStatus;
  actions: NpActions;
}

/**
 * Екран «Нова Пошта» (B10, ТЗ 6.12): чи є ключ і чи працює з’єднання, відправник кожної локації й
 * вага порожніх боксів. Лише власник. Сам ключ тут не показується і в базі не зберігається.
 */
export default function NpSettingsContent({
  view,
  sync,
  unresolved,
  tracking,
  actions,
}: NpSettingsContentProps) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="np-connection" className="flex max-w-xl flex-col gap-3">
        <SectionTitle id="np-connection">З’єднання</SectionTitle>
        {view.hasKey ? (
          <Notification variant="success">Ключ Нової Пошти налаштовано.</Notification>
        ) : (
          <Notification variant="warning" title="Ключа немає">
            Додайте ключ у змінну середовища сервера (NOVA_POSHTA_API_KEY) і перезапустіть
            застосунок. У базі й на екрані ключ не зберігається.
          </Notification>
        )}
        {view.lastCheck ? (
          <Notification variant={view.lastCheck.ok ? "success" : "error"}>
            {view.lastCheck.message}{" "}
            <span className="whitespace-nowrap">
              Перевірено {formatDateTime(new Date(view.lastCheck.at))}.
            </span>
          </Notification>
        ) : (
          <Text variant="muted">З’єднання ще не перевіряли.</Text>
        )}
        <ConnectionCheck action={actions.check} disabled={!view.hasKey} />
      </section>

      <section aria-labelledby="np-directories" className="flex max-w-xl flex-col gap-3">
        <SectionTitle id="np-directories">Довідники міст і відділень</SectionTitle>
        <Text variant="muted">
          Копія списків Нової Пошти для швидкого вибору адреси. Оновлюється щодоби сама (на бойовій
          базі), тут можна оновити вручну.
        </Text>
        <Text>
          У копії: міст {sync.storedCities}, відділень {sync.storedWarehouses}.{" "}
          {sync.lastFinishedAt
            ? `Оновлено ${formatDateTime(new Date(sync.lastFinishedAt))}.`
            : "Ще не завантажували."}
        </Text>
        {sync.phase !== "idle" ? (
          <Notification variant="info">
            Завантаження триває: {sync.phase === "cities" ? "міста" : "відділення"}, сторінка{" "}
            {sync.page}. Натисніть «Оновити зараз», щоб продовжити.
          </Notification>
        ) : null}
        <DirectorySync sync={actions.sync} />
      </section>

      <section aria-labelledby="np-tracking" className="flex max-w-xl flex-col gap-3">
        <SectionTitle id="np-tracking">Статуси накладних</SectionTitle>
        <Text variant="muted">
          Нова Пошта опитується кожні 15 хвилин (на бойовій базі): статус накладної оновлюється в
          замовленні, а коли посилку відправлено, замовлення «Запаковано» саме стає «Відправлено».
        </Text>
        <Text>
          Відстежується накладних: {tracking.active}.{" "}
          {tracking.lastFinishedAt
            ? `Востаннє перевірено ${formatDateTime(new Date(tracking.lastFinishedAt))}.`
            : "Ще не перевіряли."}
        </Text>
        <TrackAll action={actions.trackAll} disabled={!view.hasKey} />
      </section>

      <section aria-labelledby="np-addresses" className="flex flex-col gap-3">
        <SectionTitle id="np-addresses">Адреси, що потребують уточнення</SectionTitle>
        <Text variant="muted" className="max-w-xl">
          Накладну можна створити лише для адреси, зіставленої з довідником. Однозначні адреси
          система зіставить сама, решту вибирають на картці клієнта, вкладка «Адреси».
        </Text>
        <div className="max-w-xl">
          <AutoResolve action={actions.autoResolve} />
        </div>
        {unresolved.total === 0 ? (
          <Text variant="muted">Усі адреси Нової Пошти зіставлені.</Text>
        ) : (
          <>
            <Text>Усього: {unresolved.total}.</Text>
            <ul className="grid gap-3 lg:grid-cols-2">
              {unresolved.items.map((item) => (
                <Card as="li" key={item.id} className="flex flex-col gap-1">
                  <Link
                    href={`/clients/${item.clientId}?tab=addresses`}
                    className="text-h2 break-words text-navy underline-offset-2 lg:hover:underline"
                  >
                    {item.clientName}
                  </Link>
                  <Text variant="muted">{item.kindLabel}</Text>
                  <Text className="break-words">{item.text}</Text>
                </Card>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="np-senders" className="flex flex-col gap-3">
        <SectionTitle id="np-senders">Відправник по локаціях</SectionTitle>
        <Text variant="muted" className="max-w-xl">
          Звідки відправляємо посилки: відправник, контактна особа, адреса й телефон. Список бере
          Нова Пошта з вашого акаунта, вам лише обрати.
        </Text>
        <ul className="grid gap-4 lg:grid-cols-2">
          {view.locations.map((location) => (
            <Card as="li" key={location.locationId} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <SubTitle>{location.name}</SubTitle>
                <Tag className="shrink-0">
                  {location.isConfigured ? "Налаштовано" : "Не налаштовано"}
                </Tag>
              </div>
              {location.isConfigured ? (
                <div className="flex flex-col gap-1">
                  {location.senderName ? <Text>{location.senderName}</Text> : null}
                  {location.contactName ? (
                    <Text variant="muted">{location.contactName}</Text>
                  ) : null}
                  {location.addressName ? (
                    <Text variant="muted">{location.addressName}</Text>
                  ) : null}
                  {location.phone ? <Text variant="muted">{location.phone}</Text> : null}
                </div>
              ) : null}
              <Disclosure
                summary={location.isConfigured ? "Змінити відправника" : "Налаштувати відправника"}
              >
                <SenderForm
                  locationId={location.locationId}
                  currentPhone={location.phone}
                  actions={actions}
                />
              </Disclosure>
            </Card>
          ))}
        </ul>
      </section>

      <section aria-labelledby="np-weights" className="flex flex-col gap-3">
        <SectionTitle id="np-weights">Вага порожніх боксів</SectionTitle>
        <Text variant="muted" className="max-w-xl">
          Вага посилки в накладній = лід + порожні бокси. Без ваги бокса рахується лише лід.
        </Text>
        <ul className="grid gap-4 lg:grid-cols-2">
          {view.boxTypes.map((type) => (
            <Card as="li" key={type.id}>
              <EmptyWeightForm
                action={actions.saveWeight}
                boxTypeId={type.id}
                name={type.name}
                weightKg={type.emptyWeightKg}
              />
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
