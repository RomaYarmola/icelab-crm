import Link from "next/link";
import { CLIENT_TAB_LABELS, CLIENT_TABS, type ClientTab } from "@/constants/clients";
import { INLINE_HINTS } from "@/constants/hints";
import type { ClientFormOptions } from "@/server/client-options";
import type { AuditPage } from "@/server/audit";
import type { ClientCardView } from "@/server/client-views";
import type { DefaultPriceHistoryItem } from "@/server/prices";
import EntityHistory from "../auditPage/EntityHistory";
import Tag from "../shared/chips/Tag";
import BackLink from "../shared/links/BackLink";
import Notification from "../shared/notification/Notification";
import TabLinks from "../shared/tabs/TabLinks";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import AddressesTab from "./AddressesTab";
import AssignRegionForm from "./AssignRegionForm";
import type { ClientCardActions } from "./clientActions";
import ClientForm from "./ClientForm";
import ClientOwnerActions from "./ClientOwnerActions";
import ClientSummary from "./ClientSummary";
import ContactsTab from "./ContactsTab";
import PricesTab from "./PricesTab";

interface ClientCardContentProps {
  client: ClientCardView;
  tab: ClientTab;
  options: ClientFormOptions;
  actions: ClientCardActions;
  permissions: {
    /** Роль змінює клієнтів (власник, менеджер). */
    canWrite: boolean;
    /** Роль змінює ціни клієнта (власник, менеджер). */
    canEditPrices: boolean;
    isOwner: boolean;
  };
  /** Роль бачить вкладку «Історія» (як і «Ціни»: власник, менеджер, бухгалтер). */
  canSeeHistory: boolean;
  /** Історія змін клієнта, завантажена, коли відкрито вкладку «Історія». */
  history: AuditPage | null;
  /** Прайс для порівняння на вкладці «Ціни» (лише ролям з правом на ціни). */
  defaultPrices: DefaultPriceHistoryItem[] | null;
  /** Сьогоднішня дата `YYYY-MM-DD`. */
  today: string;
  /** Клієнта щойно створено або об'єднано: показуємо підтвердження. */
  notice?: "created" | "merged";
  /** Адреса вкладки. Типово справжня картка; каталог `/ui-kit` підставляє свою, щоб лишатись у собі. */
  tabHref?: (tab: ClientTab) => string;
}

/**
 * Картка клієнта: заголовок, вкладки «Основне», «Контакти», «Адреси» і «Ціни». Вкладка «Ціни» є лише
 * в ролей з правом на ціни: старший локації її не бачить, ціни до нього навіть не доходять із
 * сервера. Видалений клієнт відкривається лише для перегляду.
 */
export default function ClientCardContent({
  client,
  tab,
  options,
  actions,
  permissions,
  defaultPrices,
  canSeeHistory,
  history,
  today,
  notice,
  tabHref = (id) => (id === "main" ? `/clients/${client.id}` : `/clients/${client.id}?tab=${id}`),
}: ClientCardContentProps) {
  const canSeePrices = client.prices !== undefined;
  const canEdit = permissions.canWrite && !client.isDeleted;
  const tabs = CLIENT_TABS.filter(
    (id) => (id !== "prices" || canSeePrices) && (id !== "history" || canSeeHistory),
  );
  const activeTab = tabs.includes(tab) ? tab : "main";
  const details = [client.statusName, client.managerName].filter(Boolean).join(" · ");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href="/clients">Клієнти</BackLink>

      {notice === "created" ? (
        <Notification variant="success">Клієнта створено. Його код: {client.code}.</Notification>
      ) : null}
      {notice === "merged" ? (
        <Notification variant="success">Клієнтів об’єднано. Дубль приховано.</Notification>
      ) : null}
      {client.isDeleted ? (
        <Notification variant="warning">
          {client.mergedIntoId ? (
            <>
              Клієнта об’єднано з{" "}
              <Link href={`/clients/${client.mergedIntoId}`} className="font-semibold underline">
                іншим клієнтом
              </Link>
              .
            </>
          ) : (
            "Клієнта видалено: він прихований зі списку."
          )}
        </Notification>
      ) : null}

      <section aria-labelledby="client-title" className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle id="client-title" className="min-w-0 break-words">
            {client.name}
          </SectionTitle>
          <Tag className="shrink-0">{client.code}</Tag>
        </div>
        {details ? <Text variant="muted">{details}</Text> : null}
      </section>

      <TabLinks
        label="Розділи картки клієнта"
        activeId={activeTab}
        items={tabs.map((id) => ({
          id,
          label: CLIENT_TAB_LABELS[id],
          href: tabHref(id),
        }))}
      />

      {activeTab === "main" ? (
        <div className="flex flex-col gap-6">
          {canEdit ? (
            <ClientForm
              // Після збереження сервер віддає нові дані: ключ перестворює форму зі свіжими значеннями.
              key={String(client.updatedAt)}
              mode="edit"
              clientId={client.id}
              code={client.code}
              options={options}
              defaults={{
                name: client.name,
                regionPrefix: "",
                phone: "",
                contactName: "",
                legalType: client.legalType ?? "",
                edrpou: client.edrpou ?? "",
                iceTypeId: client.iceTypeId ?? "",
                applicationId: client.applicationId ?? "",
                statusId: client.statusId ?? "",
                managerId: client.managerId ?? "",
                sourceId: client.sourceId ?? "",
                defaultBoxTypeId: client.defaultBoxTypeId ?? "",
                markupPercentOverride:
                  client.markupPercentOverride === null
                    ? ""
                    : String(Number(client.markupPercentOverride)),
                inactiveDaysThreshold:
                  client.inactiveDaysThreshold === null ? "" : String(client.inactiveDaysThreshold),
                notes: client.notes ?? "",
              }}
              action={actions.update}
              submitLabel="Зберегти зміни"
            />
          ) : (
            <ClientSummary client={client} />
          )}
          {canEdit && /^[0-9]+$/.test(client.code) ? (
            <AssignRegionForm
              clientId={client.id}
              regions={options.regions}
              action={actions.assignRegion}
            />
          ) : null}
          {permissions.isOwner && !client.isPlaceholder ? (
            <ClientOwnerActions
              clientId={client.id}
              isDeleted={client.isDeleted}
              mergedIntoId={client.mergedIntoId}
              actions={actions}
            />
          ) : null}
        </div>
      ) : null}

      {activeTab === "contacts" ? (
        <ContactsTab
          clientId={client.id}
          contacts={client.contacts}
          actions={actions}
          canEdit={canEdit}
        />
      ) : null}

      {activeTab === "addresses" ? (
        <AddressesTab
          clientId={client.id}
          addresses={client.addresses}
          actions={actions}
          canEdit={canEdit}
        />
      ) : null}

      {activeTab === "history" && history ? (
        <EntityHistory
          page={history}
          titleId="client-history"
          description={INLINE_HINTS.clientHistory}
        />
      ) : null}

      {activeTab === "prices" && client.prices ? (
        <PricesTab
          clientId={client.id}
          prices={client.prices}
          defaults={defaultPrices ?? []}
          iceTypes={options.iceTypes}
          today={today}
          canEdit={canEdit && permissions.canEditPrices}
          action={actions.changePrice}
        />
      ) : null}
    </div>
  );
}
