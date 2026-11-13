import Link from "next/link";
import type { OrderCardView } from "@/server/order-views";
import type { TransitionOption } from "@/server/order-rules";
import { formatIsoDate } from "@/utils/isoDate";
import DeleteRecordForm from "../clientsPage/DeleteRecordForm";
import StatusChip from "../shared/chips/StatusChip";
import ButtonLink from "../shared/buttons/ButtonLink";
import BackLink from "../shared/links/BackLink";
import MainLink from "../shared/links/MainLink";
import Notification from "../shared/notification/Notification";
import Text from "../shared/texts/Text";
import SectionTitle from "../shared/titles/SectionTitle";
import type { OrderCardActions } from "./orderActions";
import OrderHistory from "./OrderHistory";
import OrderItemsEditor from "./OrderItemsEditor";
import OrderItemsList from "./OrderItemsList";
import OrderPriceForm from "./OrderPriceForm";
import OrderSummary from "./OrderSummary";
import OrderTransitions from "./OrderTransitions";

interface OrderCardContentProps {
  order: OrderCardView;
  /** Кнопки переходів, доступні ролі (D51). */
  transitions: TransitionOption[];
  permissions: {
    /** Власник змінює ціну підтвердженого замовлення (D52). */
    canOverridePrice: boolean;
    /** Власник і менеджер видаляють чернетку (D58). */
    canDeleteDraft: boolean;
    /** Роль може змінювати щось у замовленні (кнопка «Змінити»). */
    canEdit: boolean;
    /** Роль керує додатковими позиціями (власник і менеджер, поки основні поля відкриті). */
    canEditItems: boolean;
    /** Зміни позицій потребують причини: замовлення вже у виробництві. */
    itemsNeedNote: boolean;
  };
  actions: OrderCardActions;
  /** Замовлення щойно створено: показуємо підтвердження. */
  notice?: "created";
}

/**
 * Картка замовлення: заголовок зі статусом, кнопки переходів, основні дані, позиції із сумою,
 * історія статусів. Гроші (ціни, суми, зміни ціни) є лише в ролей, яким їх віддав сервер.
 */
export default function OrderCardContent({
  order,
  transitions,
  permissions,
  actions,
  notice,
}: OrderCardContentProps) {
  const isCancelled = order.status === "cancelled";
  const canChangePrice =
    permissions.canOverridePrice &&
    order.pricePerKgSnapshot != null &&
    !isCancelled &&
    order.status !== "closed";

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href="/orders">Замовлення</BackLink>

      {notice === "created" ? (
        <Notification variant="success">Замовлення створено як чернетку.</Notification>
      ) : null}
      {isCancelled ? (
        <Notification variant="warning">
          Замовлення скасовано{order.cancelReason ? `: ${order.cancelReason}` : ""}.{" "}
          {order.duplicateOf ? (
            <>
              Це дубль{" "}
              <Link href={`/orders/${order.duplicateOf}`} className="font-semibold underline">
                першого замовлення
              </Link>
              .
            </>
          ) : null}
        </Notification>
      ) : null}

      <section aria-labelledby="order-title" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle id="order-title" className="min-w-0 break-words">
            Замовлення № {order.number ?? "—"}
          </SectionTitle>
          <StatusChip status={order.status} className="shrink-0" />
        </div>
        <Text variant="muted">
          <MainLink href={`/clients/${order.clientId}`}>
            {order.clientCode} · {order.clientName}
          </MainLink>
          {" · "}
          {formatIsoDate(order.orderDate)}
        </Text>
      </section>

      <OrderTransitions orderId={order.id} options={transitions} action={actions.transition} />
      {permissions.canEdit ? (
        <ButtonLink href={`/orders/${order.id}/edit`} variant="outline" fullWidth>
          Змінити замовлення
        </ButtonLink>
      ) : null}

      <OrderSummary order={order} />

      <OrderItemsList
        items={order.items}
        total={order.total}
        lockedPrice={order.pricePerKgSnapshot}
        priceChanges={order.priceChanges}
      />
      {permissions.canEditItems ? (
        <OrderItemsEditor
          orderId={order.id}
          items={order.items.filter((item) => item.kind !== "ice")}
          needsNote={permissions.itemsNeedNote}
          actions={actions}
        />
      ) : null}
      {canChangePrice ? <OrderPriceForm orderId={order.id} action={actions.changePrice} /> : null}

      <OrderHistory history={order.history} />

      {permissions.canDeleteDraft ? (
        <DeleteRecordForm
          action={actions.remove}
          id={order.id}
          summary="Видалити чернетку"
          warning="Чернетку буде видалено зі списку. Підтверджені замовлення не видаляють, а скасовують."
        />
      ) : null}
    </div>
  );
}
