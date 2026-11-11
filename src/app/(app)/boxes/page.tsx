import type { Metadata } from "next";
import BoxIcon from "@/components/shared/icons/BoxIcon";
import PlaceholderPage from "@/components/shared/placeholderPage/PlaceholderPage";

export const metadata: Metadata = { title: "Бокси" };

export default function BoxesPage() {
  return <PlaceholderPage icon={<BoxIcon />} title="Тут буде облік боксів" />;
}
