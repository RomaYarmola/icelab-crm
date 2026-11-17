import TabLinks from "../shared/tabs/TabLinks";

interface OrdersTabsProps {
  active: "orders" | "drafts";
  /** Скільки чернеток чекає підтвердження. */
  draftsCount: number;
}

/** Вкладки «Замовлення» і «Чернетки» (з лічильником) для власника й менеджера. */
export default function OrdersTabs({ active, draftsCount }: OrdersTabsProps) {
  return (
    <TabLinks
      label="Розділи замовлень"
      activeId={active}
      items={[
        { id: "orders", label: "Замовлення", href: "/orders" },
        {
          id: "drafts",
          label: draftsCount > 0 ? `Чернетки (${draftsCount})` : "Чернетки",
          href: "/orders/drafts",
        },
      ]}
    />
  );
}
