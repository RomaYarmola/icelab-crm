import { ReactNode } from "react";
import EmptyState from "../emptyState/EmptyState";

interface PlaceholderPageProps {
  icon: ReactNode;
  /** Одна фраза: що тут буде. */
  title: string;
}

/** Заглушка розділу, екран якого з'явиться в одному з наступних оновлень. */
export default function PlaceholderPage({ icon, title }: PlaceholderPageProps) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description="Розділ у розробці. Він з’явиться в одному з наступних оновлень."
    />
  );
}
