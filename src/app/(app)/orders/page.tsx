import type { Metadata } from "next";
import OrdersIcon from "@/components/shared/icons/OrdersIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";

export const metadata: Metadata = { title: "Замовлення" };

export default function OrdersPage() {
  return <PlaceholderPage icon={<OrdersIcon />} title="Тут буде список замовлень" />;
}
