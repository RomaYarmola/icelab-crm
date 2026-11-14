import TabLinks from "../shared/tabs/TabLinks";

export type BoxesTabId = "registry" | "debts" | "stock";

interface BoxesTabsProps {
  active: BoxesTabId;
  /** Реєстр бачать лише власник і старший локації. */
  showRegistry: boolean;
}

/** Вкладки розділу «Бокси»: реєстр, борги, склад. Кожна має свою адресу. */
export default function BoxesTabs({ active, showRegistry }: BoxesTabsProps) {
  const items = [
    ...(showRegistry ? [{ id: "registry", label: "Реєстр", href: "/boxes" }] : []),
    { id: "debts", label: "Борги", href: "/boxes/debts" },
    { id: "stock", label: "Склад", href: "/boxes/stock" },
  ];
  return <TabLinks label="Розділи боксів" activeId={active} items={items} />;
}
