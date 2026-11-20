import Link from "next/link";
import { INLINE_HINTS } from "@/constants/hints";
import type { AuditPage } from "@/server/audit";
import type { OrderCardView } from "@/server/order-views";
import type { TransitionOption } from "@/server/order-rules";
import { formatIsoDate } from "@/utils/isoDate";
import type { OrderBox } from "@/server/boxes";
import EntityHistory from "../auditPage/EntityHistory";
import OrderBoxes from "../boxesPage/OrderBoxes";
import type { ShipmentCard } from "@/server/np/shipments";
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
import OrderShipment, { type ShipmentActions } from "./OrderShipment";
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
    /** Зміни позицій потребують причини: замовлення вже у виробництві. */
  };
  actions: OrderCardActions;
  /** Посилання «Готівка» на екран готівки (ролі, що читають готівку, по готівкових замовленнях). */
  cashHref?: string | null;
  /** Історія змін замовлення (D91): лише ролі, що бачать гроші (власник, менеджер, бухгалтер). */
  changeHistory?: AuditPage | null;
  /** Бокси замовлення з кодами (ролі, що бачать бокси) і дія «Продати бокс» (власник, старший локації). */
  boxes?: OrderBox[] | null;
  /** Блок «Нова Пошта» (B10): лише ролі з правом на накладні й замовлення зі способом «Нова Пошта». */
  shipment?: { card: ShipmentCard; actions: ShipmentActions } | null;
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
  cashHref,
  changeHistory,
  boxes,
  shipment,
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
      {cashHref ? (
        <ButtonLink href={cashHref} variant="outline" fullWidth>
          Готівка
        </ButtonLink>
      ) : null}
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
      {boxes ? <OrderBoxes boxes={boxes} /> : null}
      {shipment ? (
        <OrderShipment orderId={order.id} card={shipment.card} actions={shipment.actions} />
      ) : null}
      {canChangePrice ? <OrderPriceForm orderId={order.id} action={actions.changePrice} /> : null}

      <OrderHistory history={order.history} />
      {changeHistory ? (
        <EntityHistory
          page={changeHistory}
          titleId="order-change-history"
          description={INLINE_HINTS.orderChangeHistory}
        />
      ) : null}

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
