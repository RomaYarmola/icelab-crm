import { ADDRESS_KIND_LABELS } from "@/constants/clients";
import type { AddressView } from "@/server/client-views";
import Card from "../shared/cards/Card";
import Tag from "../shared/chips/Tag";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import Text from "../shared/texts/Text";
import SubTitle from "../shared/titles/SubTitle";
import AddressForm from "./AddressForm";
import type { ClientCardActions } from "./clientActions";
import DeleteRecordForm from "./DeleteRecordForm";

interface AddressesTabProps {
  clientId: string;
  addresses: AddressView[];
  actions: ClientCardActions;
  canEdit: boolean;
}

/** Вкладка «Адреси»: доставка, склад чи адреса Нової Пошти, автобус; одна за замовчуванням. */
export default function AddressesTab({ clientId, addresses, actions, canEdit }: AddressesTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <Disclosure key={addresses.length} summary="Додати адресу">
          <AddressForm
            mode="add"
            clientId={clientId}
            defaults={{
              kind: "delivery",
              label: "",
              cityText: "",
              addressText: "",
              recipientName: "",
              npWarehouseNumber: "",
              timeWindow: "",
              isDefault: addresses.length === 0,
            }}
            action={actions.addAddress}
            submitLabel="Додати адресу"
          />
        </Disclosure>
      ) : null}

      {addresses.length === 0 ? (
        <EmptyState title="Адрес ще немає" description="Додайте адресу доставки чи відділення." />
      ) : (
        <ul className="flex flex-col gap-3">
          {addresses.map((address) => (
            <Card as="li" key={address.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <SubTitle className="min-w-0 break-words">
                  {address.label || ADDRESS_KIND_LABELS[address.kind]}
                </SubTitle>
                {address.isDefault ? <Tag className="shrink-0">За замовчуванням</Tag> : null}
              </div>
              {address.label ? (
                <Text variant="muted">{ADDRESS_KIND_LABELS[address.kind]}</Text>
              ) : null}
              {address.cityText || address.addressText ? (
                <Text className="break-words whitespace-pre-line">
                  {[address.cityText, address.addressText].filter(Boolean).join(", ")}
                </Text>
              ) : null}
              {address.npWarehouseNumber ? (
                <Text variant="muted">Відділення № {address.npWarehouseNumber}</Text>
              ) : null}
              {address.recipientName ? (
                <Text variant="muted">Отримувач: {address.recipientName}</Text>
              ) : null}
              {address.timeWindow ? (
                <Text variant="muted">Вікно доставки: {address.timeWindow}</Text>
              ) : null}
              {canEdit ? (
                <div className="flex flex-col gap-1 border-t border-grey-border pt-2">
                  <Disclosure
                    key={`${address.kind}-${address.label}-${address.cityText}-${address.addressText}-${address.recipientName}-${address.npWarehouseNumber}-${address.timeWindow}-${address.isDefault}`}
                    variant="plain"
                    summary="Змінити"
                  >
                    <AddressForm
                      mode="edit"
                      addressId={address.id}
                      defaults={{
                        kind: address.kind,
                        label: address.label ?? "",
                        cityText: address.cityText ?? "",
                        addressText: address.addressText ?? "",
                        recipientName: address.recipientName ?? "",
                        npWarehouseNumber: address.npWarehouseNumber ?? "",
                        timeWindow: address.timeWindow ?? "",
                        isDefault: address.isDefault,
                      }}
                      action={actions.updateAddress}
                      submitLabel="Зберегти адресу"
                    />
                  </Disclosure>
                  <DeleteRecordForm
                    action={actions.deleteAddress}
                    id={address.id}
                    summary="Видалити адресу"
                    warning="Адреса зникне з картки. Це не можна скасувати."
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
