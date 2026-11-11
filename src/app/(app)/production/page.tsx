import type { Metadata } from "next";
import ProductionIcon from "@/components/shared/icons/ProductionIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";

export const metadata: Metadata = { title: "Виробництво" };

export default function ProductionPage() {
  return <PlaceholderPage icon={<ProductionIcon />} title="Тут буде екран виробництва" />;
}
