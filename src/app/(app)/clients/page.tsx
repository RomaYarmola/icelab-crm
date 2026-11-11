import type { Metadata } from "next";
import ClientsIcon from "@/components/shared/icons/ClientsIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";

export const metadata: Metadata = { title: "Клієнти" };

export default function ClientsPage() {
  return <PlaceholderPage icon={<ClientsIcon />} title="Тут буде список клієнтів" />;
}
