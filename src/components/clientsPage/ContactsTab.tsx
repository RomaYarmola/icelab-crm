import type { ContactView } from "@/server/client-views";
import { formatPhone } from "@/utils/phone";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import type { ClientCardActions } from "./clientActions";
import ContactForm from "./ContactForm";
import DeleteRecordForm from "./DeleteRecordForm";

interface ContactsTabProps {
  clientId: string;
  contacts: ContactView[];
  actions: ClientCardActions;
  /** Можна змінювати: роль має право на запис, а клієнта не видалено. */
  canEdit: boolean;
}

/** Вкладка «Контакти»: телефони клієнта, один основний. Телефон натискається і набирає номер. */
export default function ContactsTab({ clientId, contacts, actions, canEdit }: ContactsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        // Після додавання кількість змінюється, ключ перестворює блок: форма очищена й згорнута.
        <Disclosure key={contacts.length} summary="Додати контакт">
          <ContactForm
            mode="add"
            clientId={clientId}
            defaults={{ name: "", phone: "", role: "", isPrimary: contacts.length === 0 }}
            action={actions.addContact}
            submitLabel="Додати контакт"
          />
        </Disclosure>
      ) : null}

      {contacts.length === 0 ? (
        <EmptyState
          title="Контактів ще немає"
          description="Додайте телефон, щоб зв'язатися з клієнтом."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {contacts.map((contact) => (
            <Card as="li" key={contact.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <SubTitle className="min-w-0 break-words">{contact.name ?? "Без імені"}</SubTitle>
                {contact.isPrimary ? <Tag className="shrink-0">Основний</Tag> : null}
              </div>
              {contact.role ? <Text variant="muted">{contact.role}</Text> : null}
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  className="inline-flex min-h-11 w-fit items-center text-lead font-semibold text-blue"
                >
                  {formatPhone(contact.phone)}
                </a>
              ) : (
                <Text variant="muted">Телефону немає</Text>
              )}
              {canEdit ? (
                <div className="flex flex-col gap-1 border-t border-grey-border pt-2">
                  <Disclosure
                    // Після збереження дані змінюються: ключ показує форму зі свіжими значеннями.
                    key={`${contact.name}-${contact.phone}-${contact.role}-${contact.isPrimary}`}
                    variant="plain"
                    summary="Змінити"
                  >
                    <ContactForm
                      mode="edit"
                      contactId={contact.id}
                      defaults={{
                        name: contact.name ?? "",
                        phone: contact.phone ?? "",
                        role: contact.role ?? "",
                        isPrimary: contact.isPrimary,
                      }}
                      action={actions.updateContact}
                      submitLabel="Зберегти контакт"
                    />
                  </Disclosure>
                  <DeleteRecordForm
                    action={actions.deleteContact}
                    id={contact.id}
                    summary="Видалити контакт"
                    warning="Контакт зникне з картки. Це не можна скасувати."
                  />
                </div>
              ) : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
