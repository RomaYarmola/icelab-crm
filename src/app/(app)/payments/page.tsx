import type { Metadata } from "next";
import PaymentsIcon from "@/components/shared/icons/PaymentsIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";

export const metadata: Metadata = { title: "Оплати" };

export default function PaymentsPage() {
  return <PlaceholderPage icon={<PaymentsIcon />} title="Тут будуть оплати" />;
}
