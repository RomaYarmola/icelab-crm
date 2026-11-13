import type { EditPolicy } from "@/server/order-rules";
import BackLink from "../shared/links/BackLink";
import SectionTitle from "../shared/titles/SectionTitle";
import OrderForm from "./OrderForm";
import type {
  OrderFormActions,
  OrderFormOptions,
  OrderFormValues,
  PickedClient,
} from "./orderFormTypes";

interface OrderFormContentProps {
  mode: "create" | "edit";
  /** Номер замовлення (для заголовка зміни). */
  orderNumber?: number | null;
  orderId?: string;
  options: OrderFormOptions;
  defaults: OrderFormValues;
  initialClient: PickedClient | null;
  policy?: EditPolicy;
  currentPrice?: string | null;
  canSeeInternal: boolean;
  actions: OrderFormActions;
}

/** Екран «Нове замовлення» або «Змінити замовлення»: назад, заголовок і форма. */
export default function OrderFormContent({
  mode,
  orderNumber,
  orderId,
  ...rest
}: OrderFormContentProps) {
  const isCreate = mode === "create";
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackLink href={isCreate ? "/orders" : `/orders/${orderId}`}>
        {isCreate ? "Замовлення" : "Замовлення"}
      </BackLink>
      <SectionTitle>
        {isCreate ? "Нове замовлення" : `Змінити замовлення № ${orderNumber ?? "—"}`}
      </SectionTitle>
      <OrderForm
        mode={mode}
        orderId={orderId}
        submitLabel={isCreate ? "Створити замовлення" : "Зберегти зміни"}
        {...rest}
      />
    </div>
  );
}
